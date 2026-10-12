import { distance } from 'fastest-levenshtein';
import { getBlockPlainText } from '../../../../structured-document-text/src/pdf/index.js';
import { compactText as getContentsTextKey, contentsLocatorMatchesPageLabel, inferContentsPageLabels } from '../contents.js';
import { titles as REFERENCE_TITLES } from '../reference/titles.js';
import { getClosestDistance, resolveDestination } from '../util.js';

const ACKNOWLEDGMENT_TOP_TITLES = [
	'acknowledgment',
	'acknowledgments',
	'acknowledgement',
	'acknowledgements',
];
const ABSTRACT_TERMINAL_TITLES = [
	'abstract',
	'resume',
	'résumé',
	'resumé',
	'resumen',
	'summary',
	'zusammenfassung',
];
const KEYWORD_TERMINAL_TITLES = [
	'index terms',
	'key word',
	'key words',
	'keyword',
	'keywords',
	'mots clés',
	'mots cles',
	'palabras clave',
	'schlagworter',
	'schlagwörter',
	'schlüsselwörter',
	'subject terms',
];
const COPYRIGHT_TERMINAL_TITLES = [
	'copyright',
];
const REFERENCE_TOP_TITLES = [
	'references',
	'bibliography',
];
const REFERENCE_TERMINAL_TITLES = new Set(REFERENCE_TITLES.map(normalizeLooseTitle));

// Match outline numbers like "1.2.3", "A.1", "IV.2", but not regular words.
const OUTLINE_NUMBER_RE = /^\s*((?:\d+|[A-Za-z]+)(?:[.-](?:\d+|[A-Za-z]+))*)(?=\s|[.)\-:]|$)/;
const ROMAN_NUMERAL_RE = /^[IVXivx]+$/;

function getOutlineNumberParts(text) {
	if (!text || typeof text !== 'string') return [];
	const match = OUTLINE_NUMBER_RE.exec(text);
	if (!match) return [];

	const parts = match[1].split(/[.-]/);

	for (const part of parts) {
		const isDigits = /^\d+$/.test(part);
		if (!isDigits) {
			const isSingleLetter = /^[A-Za-z]$/.test(part);
			const isRomanNumeral = ROMAN_NUMERAL_RE.test(part) && part.length <= 4;
			if (!isSingleLetter && !isRomanNumeral) {
				return [];
			}
		}
	}

	return parts;
}

function getUppercaseRatio(text) {
	if (!text || typeof text !== 'string' || text.length === 0) return 0;
	let uppercaseCount = 0;
	for (const char of text) {
		if (char === char.toUpperCase()) uppercaseCount++;
	}
	return Number((uppercaseCount / text.length).toFixed(2));
}

function normalizeFontName(name) {
	if (!name || typeof name !== 'string') return '';
	const plusIndex = name.indexOf('+');
	if (plusIndex !== -1 && plusIndex < name.length - 1) {
		name = name.slice(plusIndex + 1);
	}
	return name.trim();
}

function clamp(value, min, max) {
	return Math.min(Math.max(value, min), max);
}

function computeItemStyle(item) {
	const fontSize = Number.isFinite(item._fontSize) ? item._fontSize : 0;
	const sizeBucket = Math.round(fontSize * 2) / 2;
	const fontName = normalizeFontName(item._fontName || '');
	const upper = getUppercaseRatio(item.title) >= 0.9;
	item._styleKey = `${fontName}|${sizeBucket}|${upper}`;
	item._numericParts = getOutlineNumberParts(item.title);
	return item;
}

function normalizeLooseTitle(title) {
	if (!title || typeof title !== 'string') return '';
	return title
		.normalize('NFKC')
		.replace(/[^\p{L}\p{N}]+/gu, ' ')
		.trim()
		.toLowerCase();
}

function buildAllBlocksByPage(blocks, includeExcluded = false) {
	const allBlocksByPage = new Map();
	for (let i = 0; i < blocks.length; i++) {
		const block = blocks[i];
		if (!includeExcluded && block.flowClass === 'excluded') continue;
		const metrics = block._metrics || {};
		const anchorRect = block?.anchor?.pageRects?.[0];
		const rect = metrics.rect || (anchorRect ? anchorRect.slice(1) : null);
		const pageIndex = anchorRect ? anchorRect[0] : (Number.isFinite(metrics.pageIndex) ? metrics.pageIndex : null);
		if (!Number.isFinite(pageIndex)) continue;

		const entry = {
			title: getBlockPlainText(block),
			type: block.type,
			_blockIndex: i,
			_pageIndex: pageIndex,
			_rect: rect,
			_fontName: metrics.fontName || metrics.firstCharFontName || '',
			_fontSize: metrics.fontSize || metrics.firstCharFontSize || 0,
			_firstCharFontName: metrics.firstCharFontName || '',
			_firstCharFontSize: metrics.firstCharFontSize || 0,
			_contentsNavigationHeading: block._contentsNavigationHeading === true,
		};

		let list = allBlocksByPage.get(pageIndex);
		if (!list) {
			list = [];
			allBlocksByPage.set(pageIndex, list);
		}
		list.push(entry);
	}
	return allBlocksByPage;
}

function extractHeadingItems(blocks) {
	const headingItems = [];
	for (let i = 0; i < blocks.length; i++) {
		const block = blocks[i];
		if (block.flowClass === 'excluded' || block._contentsNavigationHeading) continue;
		if (block.type !== 'heading') continue;
		const metrics = block._metrics || {};
		const anchorRect = block?.anchor?.pageRects?.[0];
		const rect = metrics.rect || (anchorRect ? anchorRect.slice(1) : null);
		const pageIndex = anchorRect ? anchorRect[0] : (Number.isFinite(metrics.pageIndex) ? metrics.pageIndex : null);
		const item = {
			title: getBlockPlainText(block),
			ref: [i],
			_blockIndex: i,
			_pageIndex: pageIndex,
			_rect: rect,
			_fontName: metrics.fontName || metrics.firstCharFontName || '',
			_fontSize: metrics.fontSize || metrics.firstCharFontSize || 0,
			_orderIndex: i,
		};
		computeItemStyle(item);
		headingItems.push(item);
	}
	return headingItems;
}

export async function getNativeOutline(pdfDocument) {
	if (!pdfDocument) return [];
	let items;
	try {
		items = await pdfDocument.pdfManager.ensureCatalog('documentOutline');
	} catch {
		items = null;
	}
	if (!items) return [];

	async function transformItems(list) {
		const result = [];
		for (const item of list) {
			const newItem = {
				// Native titles can contain stray control characters (e.g. \r)
				title: (item.title || '').replace(/\s+/gu, ' ').trim(),
				items: [],
			};
			if (item.dest) {
				const position = await resolveDestination(pdfDocument, item.dest);
				if (position) {
					newItem.location = { position };
				}
			} else if (item.unsafeUrl) {
				newItem.url = item.unsafeUrl;
			}
			if (item.items && item.items.length) {
				newItem.items = await transformItems(item.items);
			}
			result.push(newItem);
		}
		return result;
	}

	return transformItems(items);
}

export function flattenNativeOutline(items, parent = null, out = []) {
	for (const item of items || []) {
		const pageIndex = item?.location?.position?.pageIndex;
		let rect = item?.location?.position?.rect;
		if (!rect && Array.isArray(item?.location?.position?.rects) && item.location.position.rects.length) {
			rect = item.location.position.rects[0];
		}
		const node = {
			title: item.title || '',
			_pageIndex: Number.isFinite(pageIndex) ? pageIndex : null,
			_rect: Array.isArray(rect) ? rect : null,
			_url: item.url,
			_parent: parent,
			_children: [],
		};
		if (parent) {
			parent._children.push(node);
		}
		out.push(node);
		if (item.items && item.items.length) {
			flattenNativeOutline(item.items, node, out);
		}
	}
	return out;
}

function recoverInlineHeadings(allBlocksByPage, confirmedStyles, usedBlockIndices) {
	const recoveredItems = [];
	if (!confirmedStyles.size) return recoveredItems;

	const skipTypes = new Set(['note', 'caption', 'table', 'image', 'math']);
	for (const pageBlocks of allBlocksByPage.values()) {
		for (const block of pageBlocks) {
			if (usedBlockIndices.has(block._blockIndex)) continue;
			if (block._contentsNavigationHeading) continue;
			if (skipTypes.has(block.type)) continue;
			if (!block.title || block.title.length > 150) continue;

			const firstCharFontSize = block._firstCharFontSize || 0;
			const firstCharFontName = normalizeFontName(block._firstCharFontName || '');
			if (!firstCharFontName && !firstCharFontSize) continue;

			const upper = getUppercaseRatio(block.title) >= 0.9;
			const firstCharSizeBucket = Math.round(firstCharFontSize * 2) / 2;
			const firstCharStyleKey = `${firstCharFontName}|${firstCharSizeBucket}|${upper}`;
			if (!confirmedStyles.has(firstCharStyleKey)) continue;

			const blockFontSize = block._fontSize || 0;
			const blockFontName = normalizeFontName(block._fontName || '');
			const blockSizeBucket = Math.round(blockFontSize * 2) / 2;
			const blockStyleKey = `${blockFontName}|${blockSizeBucket}|${upper}`;
			if (firstCharStyleKey === blockStyleKey) continue;

			const item = {
				title: block.title,
				ref: [block._blockIndex],
				_blockIndex: block._blockIndex,
				_pageIndex: block._pageIndex,
				_rect: block._rect,
				_fontName: block._firstCharFontName || '',
				_fontSize: firstCharFontSize,
				_orderIndex: block._blockIndex,
			};
			computeItemStyle(item);
			recoveredItems.push(item);
			usedBlockIndices.add(block._blockIndex);
		}
	}

	return recoveredItems;
}

function getComparableTitleKey(title) {
	return normalizeLooseTitle(title).replace(/\s/gu, '');
}

function getRowDestinations(row) {
	return row.linkDestinations || [];
}

function selectDestinationMatch(candidates, destination) {
	if (candidates.length === 1) return candidates[0];
	if (!destination?.rect || candidates.some(candidate => !candidate._rect)) return null;
	const ranked = candidates
		.map(candidate => ({
			candidate,
			distance: getClosestDistance(candidate._rect, destination.rect),
		}))
		.sort((a, b) => a.distance - b.distance);
	return ranked.length > 1 && ranked[0].distance === ranked[1].distance
		? null
		: ranked[0]?.candidate || null;
}

function findLinkedTitleMatch(row, candidatesByPage) {
	const titleKey = row.titleKey || getContentsTextKey(row.title);
	if (!titleKey) return null;
	const matches = [];
	for (const destination of getRowDestinations(row)) {
		if (!Number.isInteger(destination.pageIndex)) continue;
		const pageBlocks = candidatesByPage.get(destination.pageIndex) || [];
		const candidates = findContentsBlockMatches(row, pageBlocks)
			.map(match => ({ ...match.block, title: match.title }));
		const match = selectDestinationMatch(candidates, destination);
		if (match) matches.push(match);
	}
	const unique = matches.filter((match, index) => (
		matches.findIndex(candidate => candidate._blockIndex === match._blockIndex) === index
	));
	return unique.length === 1 ? unique[0] : null;
}

function findContentsBlockMatches(row, pageBlocks) {
	const rowKey = row.titleKey || getContentsTextKey(row.title);
	if (!rowKey) return [];
	const keys = [rowKey];
	// A contents label may be separate from the title at its destination.
	if (row.locatorKey && getOutlineNumberParts(row.title).length) {
		const titleKey = getContentsTextKey(row.title.replace(OUTLINE_NUMBER_RE, '').replace(/^[.)\s:-]+/u, ''));
		if (titleKey) keys.push(titleKey);
	}
	const matches = [];
	for (let start = 0; start < pageBlocks.length; start++) {
		if (pageBlocks[start].type !== 'heading' && pageBlocks[start].type !== 'paragraph') continue;
		let title = '';
		for (let end = start; end < pageBlocks.length; end++) {
			const block = pageBlocks[end];
			if (block.type !== 'heading' && block.type !== 'paragraph') break;
			title = title ? `${title} ${block.title}` : block.title;
			const key = getContentsTextKey(title);
			if (keys.includes(key)) {
				matches.push({ title: key === rowKey ? title : row.title, block: pageBlocks[start] });
				break;
			}
			if (!key || !keys.some(candidate => candidate.startsWith(key))) break;
		}
	}
	return matches;
}

// Once a contents region is independently confirmed, its title and printed
// page label can identify a body block even when the heading model missed it
// or the same title occurs in several chapters. Ambiguous matches stay out.
function findPrintedContentsMatch(row, allBlocksByPage, contentsPage, inferredLabels) {
	const matches = [];
	const linkedPages = new Set(getRowDestinations(row).map(destination => destination.pageIndex));
	if (Number.isInteger(row.targetPage)) {
		if ((!linkedPages.size || linkedPages.has(row.targetPage))
			&& inferredLabels[row.targetPage]?.has(row.locatorKey)) {
			matches.push(...findContentsBlockMatches(row, allBlocksByPage.get(row.targetPage) || []));
		}
	} else {
		const rowKey = getContentsTextKey(row.title);
		for (const [pageIndex, pageBlocks] of allBlocksByPage) {
			if (pageIndex <= contentsPage) continue;
			// A printed locator can corroborate an authored link, but must not redirect it.
			if (linkedPages.size && !linkedPages.has(pageIndex)) continue;
			for (const labelKey of inferredLabels[pageIndex] || []) {
				if (!labelKey) continue;
				if (row.locatorKey ? row.locatorKey !== labelKey : !rowKey.endsWith(labelKey)) continue;
				const titleKey = row.locatorKey ? rowKey : rowKey.slice(0, -labelKey.length);
				if (!titleKey) continue;
				matches.push(...findContentsBlockMatches({ ...row, titleKey }, pageBlocks));
			}
		}
	}
	return matches.length === 1 ? matches[0] : null;
}

function getLinkedContentsTitle(row, destination, pageLabels) {
	// Dot leaders separate a locator from the authored title. Only strip a
	// suffix when it agrees with the linked page's label.
	const match = /^(.*?)\s*(?:\.{2,}|…)\s*(\S+)\s*$/u.exec(row.title);
	return match && contentsLocatorMatchesPageLabel(
		getContentsTextKey(match[2]), pageLabels?.[destination.pageIndex],
	) ? match[1].trim() : row.title;
}

function buildPrintedContentsOutline(allBlocksByPage, navigationRegions, pageLabels, linkedBlocksByPage) {
	const items = [];
	const usedBlockIndices = new Set();
	const inferredLabels = inferContentsPageLabels(navigationRegions, pageLabels || []);
	for (const region of navigationRegions) {
		if (region.source !== 'heading-concentration') continue;
		for (const row of region.rows || []) {
			const linkedBlock = findLinkedTitleMatch(row, linkedBlocksByPage);
			const match = linkedBlock
				? { title: linkedBlock.title, block: linkedBlock }
				: findPrintedContentsMatch(row, allBlocksByPage, region.pageIndex, inferredLabels);
			const destinations = getRowDestinations(row);
			const destination = destinations.length === 1 ? destinations[0] : null;
			if (!match && !destination) continue;
			if (!match && destination) {
				const titleKey = getContentsTextKey(getLinkedContentsTitle(row, destination, pageLabels));
				if ((linkedBlocksByPage.get(destination.pageIndex) || []).some(block =>
					block.type === 'caption' && getContentsTextKey(block.title) === titleKey)) continue;
			}
			if (match && usedBlockIndices.has(match.block._blockIndex)) continue;
			const item = match
				? { title: match.title, ref: [match.block._blockIndex] }
				: { title: getLinkedContentsTitle(row, destination, pageLabels), target: { position: destination } };
			if (match) usedBlockIndices.add(match.block._blockIndex);
			items.push(item);
		}
	}
	return items;
}

function countHeadingStyles(items) {
	const counts = new Map();
	for (const item of items) {
		if (item?._styleKey) counts.set(item._styleKey, (counts.get(item._styleKey) || 0) + 1);
	}
	return counts;
}

function getTitleRefIndexes(titleRefs) {
	const refs = Array.isArray(titleRefs?.[0]) ? titleRefs : [titleRefs];
	const indexes = new Set();
	for (const ref of refs) {
		if (Array.isArray(ref) && Number.isInteger(ref[0])) {
			indexes.add(ref[0]);
		}
	}
	return indexes;
}

function isReferenceTopTitle(title) {
	return REFERENCE_TOP_TITLES.includes(normalizeLooseTitle(title));
}

function isReferenceTerminalTitle(title) {
	return REFERENCE_TERMINAL_TITLES.has(normalizeLooseTitle(title)) || isReferenceTopTitle(title);
}

function isAcknowledgmentTopTitle(title) {
	return ACKNOWLEDGMENT_TOP_TITLES.includes(normalizeLooseTitle(title));
}

function isAbstractTerminalTitle(title) {
	return ABSTRACT_TERMINAL_TITLES.includes(normalizeLooseTitle(title));
}

function isKeywordTerminalTitle(title) {
	return KEYWORD_TERMINAL_TITLES.includes(normalizeLooseTitle(title));
}

function isCopyrightTerminalTitle(title) {
	return COPYRIGHT_TERMINAL_TITLES.includes(normalizeLooseTitle(title));
}

function markForceTop(items, titleRefs = []) {
	const titleRefIndexes = getTitleRefIndexes(titleRefs);
	for (const item of items) {
		const isReferenceTitleRef = Array.isArray(item.ref) && titleRefIndexes.has(item.ref[0]);
		if (isReferenceTopTitle(item.title) || isAcknowledgmentTopTitle(item.title) || isReferenceTitleRef) {
			item._forceTop = true;
			item._forceTopTerminal = true;
		}
		else if (isAbstractTerminalTitle(item.title)) {
			item._forceTopTerminal = true;
		}
		else if (isCopyrightTerminalTitle(item.title)) {
			item._forceTopTerminal = true;
		}
	}
}

function markKeywordTitleTerminals(items) {
	for (const item of collectOutlineItems(items)) {
		if (isKeywordTerminalTitle(item?.title)) {
			item._forceTopTerminal = true;
		}
	}
}

function buildStyleDepthMap(items) {
	const numericMap = new Map();
	const numericAmbiguous = new Set();
	for (const item of items) {
		if (!item._numericParts || !item._numericParts.length) {
			continue;
		}

		const styleKey = item._styleKey;
		if (!styleKey) continue;
		const depth = item._numericParts.length;
		if (numericAmbiguous.has(styleKey)) continue;

		const existing = numericMap.get(styleKey);
		if (existing == null) {
			numericMap.set(styleKey, depth);
		} else if (existing !== depth) {
			numericMap.delete(styleKey);
			numericAmbiguous.add(styleKey);
		}
	}

	return numericMap;
}

function findShallowestStyleDepth(stack, styleKey) {
	for (let i = 1; i < stack.length; i++) {
		if (stack[i]._styleKey === styleKey) return i;
	}
	return null;
}

function buildOutline(items, styleDepthMap, maxDepth) {
	const root = { children: [], _level: 0 };
	const stack = [root];
	let prevItem = null;

	for (const item of items) {
		const existingStyleDepth = item._styleKey ? findShallowestStyleDepth(stack, item._styleKey) : null;
		let depth;

		if (item._forceTop) {
			depth = 1;
		} else if (item._numericParts && item._numericParts.length) {
			depth = item._numericParts.length;
		} else if (item._styleKey && styleDepthMap.has(item._styleKey) && existingStyleDepth === null) {
			depth = styleDepthMap.get(item._styleKey);
		} else if (prevItem && item._styleKey && prevItem._styleKey && item._styleKey === prevItem._styleKey) {
			depth = prevItem._level || 1;
		} else if (existingStyleDepth !== null) {
			depth = existingStyleDepth;
		} else {
			depth = stack.length;
		}

		if (!Number.isFinite(depth) || depth < 1) depth = 1;
		// Explicit section paths can express more levels than the document has fonts.
		if (!item._numericParts?.length) depth = clamp(depth, 1, maxDepth);

		while (stack.length > depth) {
			stack.pop();
		}
		if (depth > stack.length) {
			depth = stack.length;
		}

		const parent = stack[stack.length - 1];
		parent.children = parent.children || [];
		parent.children.push(item);
		item._level = depth;
		item.children = item.children || [];
		stack.push(item);
		prevItem = item;
	}

	return root.children;
}

function unwrapUniqueStyleParents(items, styleCounts) {
	const result = [];
	for (const item of items) {
		if (!item || typeof item !== 'object') continue;
		const children = Array.isArray(item.children) ? unwrapUniqueStyleParents(item.children, styleCounts) : [];
		item.children = children;

		const styleKey = item._styleKey;
		const isUnique = styleKey && styleCounts.get(styleKey) === 1;
		if (children.length && isUnique && !item._forceTop) {
			result.push(...children);
		} else {
			result.push(item);
		}
	}
	return result;
}

function collectOutlineItems(items, out = []) {
	for (const item of items || []) {
		out.push(item);
		collectOutlineItems(item.children, out);
	}
	return out;
}

function flattenOutlineNodes(items, parent = null, out = []) {
	for (const item of items || []) {
		item._parentItem = parent;
		out.push(item);
		flattenOutlineNodes(item.children, item, out);
	}
	return out;
}

function clearParentLinks(items) {
	for (const item of items || []) {
		delete item._parentItem;
		clearParentLinks(item.children);
	}
}

function isAncestorOf(ancestor, item) {
	let parent = item?._parentItem || null;
	while (parent) {
		if (parent === ancestor) {
			return true;
		}
		parent = parent._parentItem || null;
	}
	return false;
}

function getOutlineOrderIndex(item) {
	if (Array.isArray(item?.ref) && Number.isInteger(item.ref[0])) {
		return item.ref[0];
	}
	return Number.isFinite(item?._orderIndex) ? item._orderIndex : Number.POSITIVE_INFINITY;
}

function removeFromCurrentParent(rootItems, item) {
	const siblings = item._parentItem ? item._parentItem.children : rootItems;
	if (!Array.isArray(siblings)) {
		return;
	}
	const index = siblings.indexOf(item);
	if (index !== -1) {
		siblings.splice(index, 1);
	}
}

function insertByOrder(parent, item) {
	parent.children = Array.isArray(parent.children) ? parent.children : [];
	const orderIndex = getOutlineOrderIndex(item);
	let index = parent.children.findIndex(child => getOutlineOrderIndex(child) > orderIndex);
	if (index === -1) {
		index = parent.children.length;
	}
	parent.children.splice(index, 0, item);
	item._parentItem = parent;
}

function numericPartsStartWith(parts, prefix) {
	return Array.isArray(parts)
		&& Array.isArray(prefix)
		&& prefix.length > 0
		&& parts.length > prefix.length
		&& prefix.every((part, index) => part === parts[index]);
}

function findNumericParent(item, nodes) {
	if (!Array.isArray(item?._numericParts) || item._numericParts.length <= 1) {
		return null;
	}
	const currentParentParts = item._parentItem?._numericParts || [];
	if (currentParentParts.length > 0 && numericPartsStartWith(item._numericParts, currentParentParts)) {
		return null;
	}
	if (item._parentItem && currentParentParts.length === 0) {
		return null;
	}

	const itemOrderIndex = getOutlineOrderIndex(item);
	let best = null;
	for (const candidate of nodes) {
		if (candidate === item || !Array.isArray(candidate?._numericParts)) {
			continue;
		}
		if (!numericPartsStartWith(item._numericParts, candidate._numericParts)) {
			continue;
		}
		if (getOutlineOrderIndex(candidate) > itemOrderIndex) {
			continue;
		}
		if (!best
			|| candidate._numericParts.length > best._numericParts.length
			|| (
				candidate._numericParts.length === best._numericParts.length
				&& getOutlineOrderIndex(candidate) > getOutlineOrderIndex(best)
			)) {
			best = candidate;
		}
	}
	return best;
}

function repairNumericHierarchy(items) {
	if (!Array.isArray(items) || !items.length) {
		return items;
	}
	const nodes = flattenOutlineNodes(items);
	for (const item of nodes.slice().sort((a, b) => getOutlineOrderIndex(a) - getOutlineOrderIndex(b))) {
		const parent = findNumericParent(item, nodes);
		if (!parent || item._parentItem === parent || isAncestorOf(item, parent)) {
			continue;
		}
		removeFromCurrentParent(items, item);
		insertByOrder(parent, item);
	}
	clearParentLinks(items);
	return items;
}

function isTerminalTitleItem(item) {
	return !!item?._forceTopTerminal
		|| isReferenceTerminalTitle(item?.title)
		|| isAcknowledgmentTopTitle(item?.title);
}

function getSinglePartExplicitMarker(item) {
	if (!Array.isArray(item?._numericParts) || item._numericParts.length !== 1) {
		return null;
	}
	const match = /^\s*([A-Za-z]+|\d+)([.)])\s+/u.exec(item.title || '');
	if (!match) {
		return null;
	}
	const value = match[1];
	let kind;
	if (/^\d+$/u.test(value)) {
		kind = 'decimal';
	}
	else if (/^[ivx]+$/u.test(value)) {
		kind = 'roman';
	}
	else if (/^[a-z]$/u.test(value)) {
		kind = 'lower-alpha';
	}
	else if (/^[A-Z]$/u.test(value)) {
		kind = 'upper-alpha';
	}
	else {
		return null;
	}
	return { kind, value: value.toLowerCase() };
}

function getMarkerTransitionKey(parentMarker, childMarker) {
	if (!parentMarker || !childMarker || parentMarker.kind === childMarker.kind) {
		return null;
	}
	return `${parentMarker.kind}\0${childMarker.kind}`;
}

function getRepeatedMarkerTransitions(items) {
	const counts = new Map();
	function visit(siblings) {
		let previous = null;
		for (const item of siblings || []) {
			const marker = getSinglePartExplicitMarker(item);
			const previousMarker = getSinglePartExplicitMarker(previous);
			const key = getMarkerTransitionKey(previousMarker, marker);
			if (key) {
				counts.set(key, (counts.get(key) || 0) + 1);
			}
			visit(item.children);
			previous = item;
		}
	}
	visit(items);
	return new Set([...counts].filter(([, count]) => count >= 2).map(([key]) => key));
}

function findLastMarkerKindIndex(stack, kind) {
	for (let i = stack.length - 1; i >= 0; i--) {
		if (stack[i].marker?.kind === kind) {
			return i;
		}
	}
	return -1;
}

function appendMixedMarkerItem(result, stack, repeatedTransitions, item) {
	const marker = getSinglePartExplicitMarker(item);
	if (!marker) {
		result.push(item);
		stack.length = 0;
		return;
	}

	const sameKindIndex = findLastMarkerKindIndex(stack, marker.kind);
	if (sameKindIndex !== -1) {
		const parentEntry = stack[sameKindIndex - 1] || null;
		if (parentEntry) {
			insertByOrder(parentEntry.item, item);
		}
		else {
			result.push(item);
		}
		stack.length = sameKindIndex;
		stack.push({ item, marker });
		return;
	}

	for (let i = stack.length - 1; i >= 0; i--) {
		const key = getMarkerTransitionKey(stack[i].marker, marker);
		if (repeatedTransitions.has(key)) {
			insertByOrder(stack[i].item, item);
			stack.length = i + 1;
			stack.push({ item, marker });
			return;
		}
	}

	result.push(item);
	stack.length = 0;
	stack.push({ item, marker });
}

function repairMixedMarkerHierarchy(items) {
	const repeatedTransitions = getRepeatedMarkerTransitions(items);
	if (!repeatedTransitions.size) {
		return items;
	}
	function repairSiblings(siblings) {
		const result = [];
		const stack = [];
		for (const item of siblings || []) {
			item.children = repairSiblings(item.children);
			appendMixedMarkerItem(result, stack, repeatedTransitions, item);
		}
		return result;
	}
	return repairSiblings(items);
}

function liftTerminalChildren(items) {
	if (!Array.isArray(items) || !items.length) {
		return items;
	}
	const result = [];
	for (const item of items) {
		item.children = liftTerminalChildren(item.children);
		if (isTerminalTitleItem(item) && item.children?.length) {
			const children = item.children;
			item.children = [];
			result.push(item, ...children);
			continue;
		}
		result.push(item);
	}
	return result;
}

function filterOutlineItem(item) {
	if (!item || typeof item !== 'object') return null;
	const refArray = Array.isArray(item.ref) ? item.ref : [];
	const children = Array.isArray(item.children)
		? item.children.map(filterOutlineItem).filter(Boolean)
		: [];
	if (refArray.length === 0 && children.length === 0) {
		return null;
	}

	const result = { title: item.title };
	if (refArray.length > 0) result.ref = refArray;
	if (children.length > 0) result.children = children;
	return result;
}

function buildGeneratedOutline(items, titleRef) {
	const combined = items.map(item => ({ ...item, children: [] }));
	combined.sort((a, b) => getOutlineOrderIndex(a) - getOutlineOrderIndex(b));

	const styleCounts = countHeadingStyles(combined);
	markForceTop(combined, titleRef);
	const styleDepthMap = buildStyleDepthMap(combined);
	const numDistinctStyles = styleCounts.size || 1;
	const maxDepth = Math.min(6, Math.max(1, numDistinctStyles));
	const outline = buildOutline(combined, styleDepthMap, maxDepth);
	const unwrapped = unwrapUniqueStyleParents(outline, styleCounts);
	markKeywordTitleTerminals(unwrapped);
	repairNumericHierarchy(unwrapped);
	const markerRepaired = repairMixedMarkerHierarchy(unwrapped);
	const terminalLifted = liftTerminalChildren(markerRepaired);
	return terminalLifted.map(filterOutlineItem).filter(Boolean);
}

// Types that a page can place out of reading order (floats), so they must not
// take part in mapping a destination point to a position in block order.
const OUT_OF_FLOW_BLOCK_TYPES = new Set(['note', 'caption', 'table', 'image', 'math']);

// Maximum point-to-block distance for a geometric-only snap (rung 3).
const OUTLINE_GEOMETRIC_SNAP_DISTANCE = 24;

// Minimum edit-distance similarity for transferring a detected heading's
// block to a native entry (rung 2). Tolerates OCR-garbled text.
const OUTLINE_TITLE_SIMILARITY = 0.75;

// Containment ratios (shorter key length / longer key length) for the text
// match rung: lenient against heading blocks, strict against other blocks so
// a short title cannot match inside an ordinary paragraph.
const HEADING_TITLE_CONTAINMENT = 1 / 3;
const BLOCK_TITLE_CONTAINMENT = 0.8;

function titleKeysMatch(keyA, keyB, minRatio) {
	if (!keyA || !keyB) return false;
	if (keyA === keyB) return true;
	const shorter = keyA.length <= keyB.length ? keyA : keyB;
	const longer = keyA.length <= keyB.length ? keyB : keyA;
	if (!longer.includes(shorter)) return false;
	return shorter.length / longer.length >= minRatio;
}

function titleKeySimilarity(keyA, keyB) {
	if (!keyA || !keyB) return 0;
	if (keyA === keyB) return 1;
	const maxLength = Math.max(keyA.length, keyB.length);
	if (maxLength > 200) return 0;
	return 1 - distance(keyA, keyB) / maxLength;
}

function buildFlowData(allBlocksByPage, blockCount) {
	const flowBlocksByPage = new Map();
	const pageStartEntries = [];
	for (const [pageIndex, pageBlocks] of allBlocksByPage) {
		let minIndex = Number.POSITIVE_INFINITY;
		const flowBlocks = [];
		for (const block of pageBlocks) {
			minIndex = Math.min(minIndex, block._blockIndex);
			if (OUT_OF_FLOW_BLOCK_TYPES.has(block.type)) continue;
			if (!block._rect) continue;
			flowBlocks.push(block);
		}
		flowBlocks.sort((a, b) => a._blockIndex - b._blockIndex);
		flowBlocksByPage.set(pageIndex, flowBlocks);
		if (Number.isFinite(minIndex)) {
			pageStartEntries.push([pageIndex, minIndex]);
		}
	}
	pageStartEntries.sort((a, b) => a[0] - b[0]);
	function getPageStartIndex(pageIndex) {
		const entry = pageStartEntries.find(([page]) => page >= pageIndex);
		return entry ? entry[1] : blockCount;
	}
	return { flowBlocksByPage, getPageStartIndex };
}

// Map a destination point to a fractional position in top-level block order.
// A point inside a block maps to the block itself; anything else maps just
// before the geometrically nearest in-flow block on the page.
function computeFlowPosition(pageIndex, pointRect, flowData) {
	const flowBlocks = flowData.flowBlocksByPage.get(pageIndex) || [];
	let nearestBlock = null;
	let nearestDistance = Number.POSITIVE_INFINITY;
	if (pointRect) {
		for (const block of flowBlocks) {
			const distance = getClosestDistance(pointRect, block._rect);
			if (distance < nearestDistance) {
				nearestDistance = distance;
				nearestBlock = block;
			}
		}
	}
	if (!nearestBlock) {
		return {
			flowIndex: flowData.getPageStartIndex(pageIndex) - 0.5,
			nearestBlock: null,
			nearestDistance: Number.POSITIVE_INFINITY,
		};
	}
	return {
		flowIndex: nearestDistance === 0
			? nearestBlock._blockIndex
			: nearestBlock._blockIndex - 0.5,
		nearestBlock,
		nearestDistance,
	};
}

// A working authored destination remains useful even when the outline is
// short, covers only part of the document, or has broken entries elsewhere.
function isUsableNativeOutline(nativeNodes) {
	return nativeNodes.some(node => node.title && Number.isInteger(node._pageIndex) && node._pageIndex >= 0);
}

// In-flow blocks from a native entry's flow position to the end of the next
// page, in flow order. The window starts one block early: a destination that
// lands between two blocks is ambiguous by one position in either direction.
// The window is not bounded by the next native entry because destination
// points can legitimately land one block before their heading. Exact claims
// are reserved globally before greedy snapping so weaker fallbacks cannot
// steal those matches.
function collectSnapWindowBlocks(node, flowData, usedBlockIndexes) {
	const result = [];
	for (const pageIndex of [node._pageIndex, node._pageIndex + 1]) {
		for (const block of flowData.flowBlocksByPage.get(pageIndex) || []) {
			if (block._blockIndex < node._flowIndex - 1) continue;
			if (block._contentsNavigationHeading) continue;
			if (usedBlockIndexes.has(block._blockIndex)) continue;
			result.push(block);
		}
	}
	return result;
}

function getExactClaimOwners(nativeNodes, flowData) {
	const owners = new Map();
	for (const node of nativeNodes) {
		const titleKey = getComparableTitleKey(node.title);
		if (!titleKey) continue;
		for (const block of collectSnapWindowBlocks(node, flowData, new Set())) {
			if (getComparableTitleKey(block.title) !== titleKey) continue;
			const distance = Math.abs(block._blockIndex - node._flowIndex);
			const current = owners.get(block._blockIndex);
			if (!current || distance < current.distance) {
				owners.set(block._blockIndex, { node, distance });
			}
		}
	}
	return new Map([...owners].map(([blockIndex, claim]) => [blockIndex, claim.node]));
}

// Anchor native entries to blocks, most reliable evidence first:
// 1. title text found in a window block (exact matches before containment),
// 2. transfer from the first detected heading in the window (edit-distance
//    tolerant, so OCR-garbled headings still anchor),
// 3. a heading block directly at the destination point,
// 4. otherwise the entry keeps only its destination as a target.
function snapNativeNodes(nativeNodes, flowData) {
	const positioned = [];
	for (const node of nativeNodes) {
		if (!Number.isFinite(node._pageIndex)) continue;
		const flow = computeFlowPosition(node._pageIndex, node._rect, flowData);
		node._flowIndex = flow.flowIndex;
		node._nearestBlock = flow.nearestBlock;
		node._nearestDistance = flow.nearestDistance;
		positioned.push(node);
	}
	const sortedFlowIndexes = positioned.map(node => node._flowIndex).sort((a, b) => a - b);
	const exactClaimOwners = getExactClaimOwners(positioned, flowData);
	const usedBlockIndexes = new Set();
	for (const node of positioned) {
		const titleKey = getComparableTitleKey(node.title);
		const canClaim = block => (
			!exactClaimOwners.has(block._blockIndex)
				|| exactClaimOwners.get(block._blockIndex) === node
		);
		const windowBlocks = collectSnapWindowBlocks(node, flowData, usedBlockIndexes)
			.filter(canClaim);
		let exactHeadingMatch = null;
		let exactBlockMatch = null;
		let headingMatch = null;
		let blockMatch = null;
		if (titleKey) {
			for (const block of windowBlocks) {
				const blockKey = getComparableTitleKey(block.title);
				const exact = titleKey === blockKey;
				if (block.type === 'heading') {
					if (exact) {
						exactHeadingMatch = block;
						break;
					}
					if (!headingMatch && titleKeysMatch(titleKey, blockKey, HEADING_TITLE_CONTAINMENT)) {
						headingMatch = block;
					}
				} else if (exact) {
					exactBlockMatch ||= block;
				} else if (!blockMatch && titleKeysMatch(titleKey, blockKey, BLOCK_TITLE_CONTAINMENT)) {
					blockMatch = block;
				}
			}
		}
		let snapped = exactHeadingMatch || exactBlockMatch || headingMatch || blockMatch;
		if (!snapped && titleKey) {
			// Transfer considers only the first heading at/after the
			// destination within the entry's own gap: fuzzy matching must not
			// claim a heading a following entry has a stronger claim to
			// (titles differing only by a numeral are edit-distance-similar)
			const transferBound = sortedFlowIndexes.find(flowIndex => flowIndex > node._flowIndex)
				?? Number.POSITIVE_INFINITY;
			const firstHeading = windowBlocks.find(block => (
				block._blockIndex >= node._flowIndex
				&& block._blockIndex < transferBound
				&& block.type === 'heading'
			));
			if (firstHeading
					&& titleKeySimilarity(titleKey, getComparableTitleKey(firstHeading.title)) >= OUTLINE_TITLE_SIMILARITY) {
				snapped = firstHeading;
			}
		}
		if (!snapped
				&& node._nearestBlock
				&& canClaim(node._nearestBlock)
				&& node._nearestBlock.type === 'heading'
				&& !node._nearestBlock._contentsNavigationHeading
				&& !usedBlockIndexes.has(node._nearestBlock._blockIndex)
				&& node._nearestDistance <= OUTLINE_GEOMETRIC_SNAP_DISTANCE) {
			snapped = node._nearestBlock;
		}
		if (snapped) {
			node._snapBlock = snapped;
			usedBlockIndexes.add(snapped._blockIndex);
		}
	}
}

// Project the native tree verbatim: titles, order and nesting are preserved,
// block references supplement the authored destination or URL.
function projectNativeSkeleton(nodes) {
	const items = [];
	for (const node of nodes) {
		const children = projectNativeSkeleton(node._children);
		if (!node.title) {
			items.push(...children);
			continue;
		}
		const item = { title: node.title || '', source: 'native' };
		if (node._snapBlock) {
			item.ref = [node._snapBlock._blockIndex];
		}
		if (Number.isFinite(node._pageIndex)) {
			const position = { pageIndex: node._pageIndex };
			if (Array.isArray(node._rect)) {
				position.rect = node._rect;
			}
			item.target = { position };
		} else if (node._url) {
			item.target = { url: node._url };
		}
		if (children.length) {
			item.children = children;
		}
		if (item.ref || item.target || children.length) items.push(item);
	}
	return items;
}

// Preserve the authored grouping of URL entries when positional bookmarks
// cannot supply a usable skeleton.
function appendNativeUrlItems(outline, nativeNodes) {
	function project(nodes) {
		const items = [];
		for (const node of nodes) {
			const children = project(node._children || []);
			if (!node.title) {
				items.push(...children);
				continue;
			}
			if (!node._url && !children.length) continue;
			const item = { title: node.title, source: 'native' };
			if (node._url) item.target = { url: node._url };
			if (children.length) item.children = children;
			items.push(item);
		}
		return items;
	}
	return [...outline, ...project(nativeNodes.filter(node => !node._parent))];
}

export async function getOutline(blocks, titleRef, pdfDocument, nativeOutline = null, options = {}) {
	const allBlocksByPage = buildAllBlocksByPage(blocks);
	nativeOutline ||= await getNativeOutline(pdfDocument);
	const nativeNodes = flattenNativeOutline(nativeOutline);

	// Preserve the author's chosen entries and hierarchy, including sparse outlines.
	if (isUsableNativeOutline(nativeNodes)) {
		snapNativeNodes(nativeNodes, buildFlowData(allBlocksByPage, blocks.length));
		return projectNativeSkeleton(nativeNodes.filter(node => !node._parent));
	}

	const headingItems = extractHeadingItems(blocks);

	const navigationRegions = options.navigationRegions || [];
	if (navigationRegions.some(region => region.source === 'heading-concentration')) {
		const printed = buildPrintedContentsOutline(
			allBlocksByPage, navigationRegions, options.pageLabels, buildAllBlocksByPage(blocks, true),
		);
		if (printed.length) return appendNativeUrlItems(printed, nativeNodes);
		return appendNativeUrlItems(buildGeneratedOutline(headingItems, titleRef), nativeNodes);
	}

	const confirmedStyles = new Set(headingItems.map(item => item._styleKey).filter(Boolean));
	const usedBlockIndices = new Set(headingItems.map(item => item._blockIndex));
	const recovered = recoverInlineHeadings(allBlocksByPage, confirmedStyles, usedBlockIndices);
	return appendNativeUrlItems(buildGeneratedOutline([...headingItems, ...recovered], titleRef), nativeNodes);
}
