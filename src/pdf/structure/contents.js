const MIN_MATCHED_HEADINGS = 4;
const MIN_MATCH_DENSITY = 0.5;
const MIN_ORDERED_FRACTION = 0.75;
const MIN_TITLE_LENGTH = 5;
const MAX_WRAPPED_ENTRY_LINES = 4;
const NUMERIC_LABEL_RE = /^\s*[0-9]+(?:[.-][0-9]+)*[.)]?\s+/u;

function isValidRect(rect) {
	return Array.isArray(rect)
		&& rect.length === 4
		&& Number.isFinite(rect[0])
		&& Number.isFinite(rect[1])
		&& Number.isFinite(rect[2])
		&& Number.isFinite(rect[3])
		&& rect[2] >= rect[0]
		&& rect[3] >= rect[1];
}

export function compactText(text) {
	const value = String(text || '');
	let ascii = true;
	let compact = '';
	for (let index = 0; index < value.length; index++) {
		const code = value.charCodeAt(index);
		if (code > 0x7f) {
			ascii = false;
			break;
		}
		if (code >= 48 && code <= 57) compact += value[index];
		else if (code >= 65 && code <= 90) compact += String.fromCharCode(code + 32);
		else if (code >= 97 && code <= 122) compact += value[index];
	}
	if (ascii) return compact;
	return value
		.normalize('NFKC')
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]/gu, '');
}

function getTitleKey(text) {
	if (!/\p{L}/u.test(text || '')) return null;
	const key = compactText(text);
	return key.length >= MIN_TITLE_LENGTH ? key : null;
}

function getMatchedLocatorKey(text, titleKey) {
	const textKey = compactText(text);
	return textKey.startsWith(titleKey) ? textKey.slice(titleKey.length) : '';
}

export function contentsLocatorMatchesPageLabel(locatorKey, pageLabel) {
	return Boolean(locatorKey) && locatorKey === compactText(pageLabel);
}

// Repeated exact body-title matches can establish printed numbering even when
// page-label extraction misses chapter-opening pages. Do not guess across
// conflicting numbering sequences.
export function inferContentsPageLabels(regions, pageLabels) {
	const sequences = new Map();
	for (const region of regions || []) {
		for (const row of region.rows || []) {
			const match = /^(.*?)([0-9]+)$/u.exec(row.locatorKey || '');
			if (!match || !Number.isInteger(row.targetPage)) continue;
			const number = Number(match[2]);
			if (!Number.isSafeInteger(number)) continue;
			const sequence = sequences.get(match[1]) || { offsets: new Set(), pages: new Set() };
			sequence.offsets.add(row.targetPage - number);
			sequence.pages.add(row.targetPage);
			sequences.set(match[1], sequence);
		}
	}
	const labels = pageLabels.map(label => new Set([compactText(label)]));
	for (const [prefix, sequence] of sequences) {
		if (sequence.offsets.size !== 1 || sequence.pages.size < MIN_MATCHED_HEADINGS) continue;
		const [offset] = sequence.offsets;
		for (let page = 0; page < labels.length; page++) {
			const number = page - offset;
			if (number >= 0) labels[page].add(prefix + number);
		}
	}
	return labels;
}

function getLineId(line, fallback) {
	return Number.isInteger(line?.id) ? line.id : fallback;
}

function getLineStartOffset(line, fallback = 0) {
	return Number.isInteger(line?.startOffset) ? line.startOffset : fallback;
}

function getLineEndOffset(line, fallback = 0) {
	return Number.isInteger(line?.endOffset)
		? line.endOffset
		: getLineStartOffset(line, fallback);
}

function getLineCenterY(line) {
	return (line.rect[1] + line.rect[3]) / 2;
}

function getLineHeight(line) {
	return Math.max(0, line.rect[3] - line.rect[1]);
}

function rectsIntersect(a, b) {
	return isValidRect(a) && isValidRect(b)
		&& !(b[0] > a[2] || b[2] < a[0] || b[1] > a[3] || b[3] < a[1]);
}

function unionRects(lines) {
	let bbox = null;
	for (const line of lines) {
		if (!isValidRect(line?.rect)) continue;
		if (!bbox) {
			bbox = line.rect.slice();
			continue;
		}
		bbox[0] = Math.min(bbox[0], line.rect[0]);
		bbox[1] = Math.min(bbox[1], line.rect[1]);
		bbox[2] = Math.max(bbox[2], line.rect[2]);
		bbox[3] = Math.max(bbox[3], line.rect[3]);
	}
	return bbox;
}

function median(values) {
	if (!values.length) return 0;
	const sorted = values.slice().sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2
		? sorted[middle]
		: (sorted[middle - 1] + sorted[middle]) / 2;
}

function orderedFraction(values) {
	if (values.length < 2) return 0;
	let ordered = 0;
	for (let index = 1; index < values.length; index++) {
		if (values[index] >= values[index - 1]) ordered++;
	}
	return ordered / (values.length - 1);
}

export function createContentsHeadingIndex(nodes) {
	const entriesByPrefix = new Map();
	for (const node of nodes || []) {
		if (!Number.isInteger(node?._pageIndex)) continue;
		const key = getTitleKey(node.title);
		if (!key) continue;
		const entry = {
			key,
			title: node.title,
			targetPage: node._pageIndex,
			sourceBlocks: node._sourceBlocks || [node],
			requiresLink: node._requiresLink === true,
		};
		const prefix = key.slice(0, MIN_TITLE_LENGTH);
		const prefixEntries = entriesByPrefix.get(prefix) || [];
		prefixEntries.push(entry);
		entriesByPrefix.set(prefix, prefixEntries);
	}
	return entriesByPrefix;
}

function getLinkRects(link) {
	return link?.src?.rects?.length ? link.src.rects : [link?.src?.rect];
}

function getLinkedDestinations(line, links) {
	const destinations = new Map();
	for (const link of links || []) {
		if (!Number.isInteger(link?.dest?.pageIndex)) continue;
		if (!getLinkRects(link).some(rect => rectsIntersect(line.rect, rect))) continue;
		const destination = {
			pageIndex: link.dest.pageIndex,
			...(isValidRect(link.dest.rect) && { rect: link.dest.rect.slice() }),
		};
		const key = `${destination.pageIndex}|${destination.rect?.join(',') || ''}`;
		destinations.set(key, destination);
	}
	return [...destinations.values()];
}

function getLinesLinkedDestinations(lines, links) {
	const destinations = new Map();
	for (const line of lines) {
		for (const destination of getLinkedDestinations(line, links)) {
			const key = `${destination.pageIndex}|${destination.rect?.join(',') || ''}`;
			destinations.set(key, destination);
		}
	}
	return [...destinations.values()];
}

function getHeadingCandidates(headingIndex, lineKey) {
	return headingIndex?.get(lineKey.slice(0, MIN_TITLE_LENGTH)) || [];
}

function matchHeadingKey(lineKey, headingIndex, pageIndex, destinations = []) {
	if (!lineKey) return null;
	const matches = getHeadingCandidates(headingIndex, lineKey)
		.filter(entry => (
			entry.targetPage > pageIndex
			&& (!entry.requiresLink || (destinations.length > 0
				&& /^(?:[0-9]+|[ivxlcdm]+)$/iu.test(lineKey.slice(entry.key.length))))
			&& (!destinations.length || destinations.some(dest => dest.pageIndex === entry.targetPage))
			&& lineKey.startsWith(entry.key)
			&& lineKey.length - entry.key.length <= Math.max(12, Math.floor(entry.key.length * 0.3))
		))
		.sort((a, b) => b.key.length - a.key.length || a.targetPage - b.targetPage);
	if (!matches.length) return null;

	// Ambiguous repeated headings do not provide evidence. Concentration should
	// come from titles that identify one independent location in the body.
	const longest = matches[0].key.length;
	const best = matches.filter(match => match.key.length === longest);
	if (best.length !== 1) return null;
	return best[0];
}

function matchHeadingText(text, headingIndex, pageIndex, destinations) {
	const full = matchHeadingKey(getTitleKey(text), headingIndex, pageIndex, destinations);
	if (full) return full;
	// Printed section labels may be separate blocks at the destination.
	const prefix = NUMERIC_LABEL_RE.exec(text)?.[0];
	if (!prefix) return null;
	const match = matchHeadingKey(getTitleKey(text.slice(prefix.length)), headingIndex, pageIndex, destinations);
	if (!match) return null;
	const title = (prefix + match.title).trim();
	return { ...match, title, key: getTitleKey(title) };
}

function matchHeading(line, headingIndex, pageIndex, links) {
	return matchHeadingText(line.text, headingIndex, pageIndex, getLinkedDestinations(line, links));
}

function couldExtendToHeading(text, headingIndex, pageIndex) {
	return [text, text.replace(NUMERIC_LABEL_RE, '')].some(candidate => {
		const lineKey = getTitleKey(candidate);
		if (!lineKey) return true;
		return getHeadingCandidates(headingIndex, lineKey)
			.some(entry => entry.targetPage > pageIndex && entry.key.startsWith(lineKey));
	});
}

function areWrappedEntryLines(previousLine, nextLine) {
	if (!isValidRect(previousLine?.rect) || !isValidRect(nextLine?.rect)) {
		return false;
	}

	const previousWidth = previousLine.rect[2] - previousLine.rect[0];
	const nextWidth = nextLine.rect[2] - nextLine.rect[0];
	const horizontalOverlap = Math.min(previousLine.rect[2], nextLine.rect[2])
		- Math.max(previousLine.rect[0], nextLine.rect[0]);
	if (horizontalOverlap <= 0 || previousWidth <= 0 || nextWidth <= 0) {
		return false;
	}

	const verticalGap = Math.max(
		0,
		Math.max(previousLine.rect[1], nextLine.rect[1])
			- Math.min(previousLine.rect[3], nextLine.rect[3]),
	);
	const lineHeight = Math.max(
		1,
		getLineHeight(previousLine),
		getLineHeight(nextLine),
	);
	return verticalGap <= lineHeight * 1.5;
}

/**
 * Match physical page lines against headings inferred elsewhere in the PDF.
 * Links disambiguate repeated titles; they do not independently establish contents.
 */
export function getContentsEvidence(lines, links, headingIndex, pageIndex) {
	const matches = [];
	const usedSourceBlocks = new Set();
	const directMatches = (lines || []).map(line => (
		isValidRect(line?.rect) ? matchHeading(line, headingIndex, pageIndex, links) : null
	));
	for (let index = 0; index < (lines || []).length; index++) {
		const line = lines[index];
		if (!isValidRect(line?.rect)) continue;
		let matchedLines = [line];
		let heading = directMatches[index];
		let combinedText = String(line.text || '');
		if (!heading && couldExtendToHeading(combinedText, headingIndex, pageIndex)) {
			for (
				let nextIndex = index + 1;
				nextIndex < lines.length
					&& nextIndex < index + MAX_WRAPPED_ENTRY_LINES;
				nextIndex++
			) {
				const nextLine = lines[nextIndex];
				// A wrapped link can have a final fragment that also matches body
				// text independently. Prefer the complete title at the same destination.
				const linkedContinuation = directMatches[nextIndex]
					&& getLinesLinkedDestinations(matchedLines, links).length === 1
					&& getLinkedDestinations(nextLine, links).length === 1
					&& getLinesLinkedDestinations([...matchedLines, nextLine], links).length === 1;
				if (
					(directMatches[nextIndex] && !linkedContinuation)
					|| !areWrappedEntryLines(matchedLines.at(-1), nextLine)
				) {
					break;
				}
				matchedLines.push(nextLine);
				combinedText += ` ${nextLine.text || ''}`;
				heading = matchHeadingText(combinedText, headingIndex, pageIndex, getLinesLinkedDestinations(matchedLines, links));
				if (heading) {
					break;
				}
				if (!couldExtendToHeading(combinedText, headingIndex, pageIndex)) {
					break;
				}
			}
		}
		// Alternative compositions of the same body fragments are not
		// independent evidence for a contents region.
		if (!heading || heading.sourceBlocks.some(block => usedSourceBlocks.has(block))) continue;
		for (const block of heading.sourceBlocks) usedSourceBlocks.add(block);
		matches.push({
			lineIds: matchedLines.map((matchedLine, matchedIndex) => (
				getLineId(matchedLine, index + matchedIndex)
			)),
			startOffset: getLineStartOffset(line, index),
			endOffset: getLineEndOffset(matchedLines.at(-1), index + matchedLines.length - 1),
			title: heading.title,
			titleKey: heading.key,
			targetPage: heading.targetPage,
			locatorKey: getMatchedLocatorKey(combinedText, heading.key),
			linkDestinations: getLinesLinkedDestinations(matchedLines, links),
		});
		index += matchedLines.length - 1;
	}
	return { pageIndex, matches };
}

function findVisualHeading(rows, lines, pageRect) {
	if (!rows.length || !isValidRect(pageRect)) return null;
	const firstOffset = rows[0].startOffset;
	const rowIds = new Set(rows.flatMap(row => row.lineIds));
	const heading = lines
		.filter((line, index) => (
			!rowIds.has(getLineId(line, index))
			&& getLineEndOffset(line, index) < firstOffset
			&& isValidRect(line?.rect)
			&& getTitleKey(line.text)
		))
		.at(-1);
	if (!heading) return null;

	const pageWidth = pageRect[2] - pageRect[0];
	const rowLines = rows
		.flatMap(row => row.lineIds.map(lineId => lines[lineId]))
		.filter(line => isValidRect(line?.rect));
	const rowHeight = median(rowLines.map(getLineHeight));
	const verticalGap = getLineCenterY(heading)
		- Math.max(...rowLines.map(getLineCenterY));
	if (
		heading.rect[2] - heading.rect[0] <= pageWidth * 0.7
		&& (getLineHeight(heading) >= rowHeight * 1.08 || verticalGap >= rowHeight * 1.8)
	) {
		return heading;
	}
	return null;
}

function getContentsPageState(lines, pageRect, options = {}) {
	if (!Array.isArray(lines) || !isValidRect(pageRect)) return null;
	const matches = (options.evidence?.matches || [])
		.slice()
		.sort((a, b) => a.startOffset - b.startOffset);
	if (!matches.length) return null;

	const firstOffset = matches[0].startOffset;
	const lastOffset = matches.at(-1).endOffset;
	const matchedLineIds = new Set(matches.flatMap(match => match.lineIds));
	const spanLines = lines.filter((line, index) => (
		isValidRect(line?.rect)
		&& (matchedLineIds.has(getLineId(line, index)) || getTitleKey(line.text))
		&& getLineStartOffset(line, index) >= firstOffset
		&& getLineEndOffset(line, index) <= lastOffset
	));
	return {
		lines,
		pageRect,
		links: options.links,
		pageIndex: options.pageIndex,
		matches,
		spanLines,
		matchedLineIds,
	};
}

function isConfirmedContentsRun(states) {
	const matches = states.flatMap(state => state.matches);
	if (matches.length < MIN_MATCHED_HEADINGS) return false;
	// Repeated title/credit pages can match several independent text blocks
	// at one location. Navigation evidence must progress through the document.
	if (new Set(matches.map(match => match.targetPage)).size < 2) return false;
	if (orderedFraction(matches.map(match => match.targetPage)) < MIN_ORDERED_FRACTION) return false;
	const matchedLineCount = states.reduce((count, state) => count + state.matchedLineIds.size, 0);
	const spanLineCount = states.reduce((count, state) => count + state.spanLines.length, 0);
	return matchedLineCount / Math.max(1, spanLineCount) >= MIN_MATCH_DENSITY;
}

function hasContentsPageDensity(state) {
	return state.matchedLineIds.size / Math.max(1, state.spanLines.length) >= MIN_MATCH_DENSITY;
}

function getFullyLinkedDestination(line, links) {
	const destinations = getLinkedDestinations(line, links);
	if (destinations.length !== 1 || !line.words?.length) return null;
	const rects = (links || [])
		.filter(link => link?.dest?.pageIndex === destinations[0].pageIndex)
		.flatMap(getLinkRects)
		.filter(isValidRect);
	const covered = line.words.every(word => {
		if (!isValidRect(word.rect)) return false;
		const x = (word.rect[0] + word.rect[2]) / 2;
		const y = (word.rect[1] + word.rect[3]) / 2;
		return rects.some(rect => x >= rect[0] && x <= rect[2] && y >= rect[1] && y <= rect[3]);
	});
	return covered ? destinations[0] : null;
}

function getContentsLineGap(a, b) {
	if (!isValidRect(a?.rect) || !isValidRect(b?.rect)) return Infinity;
	if (Math.min(a.rect[2], b.rect[2]) <= Math.max(a.rect[0], b.rect[0])) return Infinity;
	if (b.rect[3] > a.rect[3]) return Infinity;
	return Math.max(0, a.rect[1] - b.rect[3]);
}

// Confirmation uses independent body-heading matches. Once confirmed, extend
// through adjacent, fully linked rows that continue its page sequence and
// observed spacing. An inline citation in surrounding prose is insufficient.
function getCompleteContentsSpan(state) {
	const { lines, spanLines, matches, links, pageIndex } = state;
	const result = spanLines.slice();
	const gaps = spanLines.slice(1).map((line, index) => getContentsLineGap(spanLines[index], line))
		.filter(Number.isFinite);
	const maxGap = Math.max(0, ...gaps) + 0.01;
	for (const direction of [-1, 1]) {
		let edge = direction < 0 ? result[0] : result.at(-1);
		let targetPage = direction < 0 ? matches[0].targetPage : matches.at(-1).targetPage;
		for (let index = lines.indexOf(edge) + direction; index >= 0 && index < lines.length; index += direction) {
			const line = lines[index];
			const destination = getFullyLinkedDestination(line, links);
			const gap = direction < 0 ? getContentsLineGap(line, edge) : getContentsLineGap(edge, line);
			if (!getTitleKey(line.text) || !destination || gap > maxGap
				|| destination.pageIndex <= pageIndex
				|| direction * (destination.pageIndex - targetPage) < 0) break;
			if (direction < 0) result.unshift(line);
			else result.push(line);
			edge = line;
			targetPage = destination.pageIndex;
		}
	}
	return result;
}

function getAlignedLocator(line, locatorEdges) {
	const words = line.words || [];
	if (words.length < 2) return null;
	const last = words.at(-1);
	const previous = words.at(-2);
	if (!isValidRect(last.rect) || !isValidRect(previous.rect)) return null;
	const height = getLineHeight(line);
	if (last.rect[0] - previous.rect[2] <= height) return null;
	if (!locatorEdges.some(edge => Math.abs(last.rect[2] - edge) <= height / 2)) return null;
	const locatorKey = compactText(last.text);
	return locatorKey ? { title: words.slice(0, -1).map(word => word.text).join(' '), locatorKey } : null;
}

function buildContentsRegion(state) {
	const { lines, pageRect, links, matches, matchedLineIds } = state;
	const spanLines = getCompleteContentsSpan(state);
	const locatorEdges = matches.flatMap(match => {
		const lastWord = lines[match.lineIds.at(-1)]?.words?.at(-1);
		return lastWord && isValidRect(lastWord.rect) && compactText(lastWord.text) === match.locatorKey
			? [lastWord.rect[2]] : [];
	});

	const matchesByLine = new Map(matches.map(match => [match.lineIds[0], match]));
	const rows = spanLines.flatMap((line) => {
		const lineId = getLineId(line, lines.indexOf(line));
		if (matchedLineIds.has(lineId) && !matchesByLine.has(lineId)) return [];
		const match = matchesByLine.get(lineId);
		const locator = match || getAlignedLocator(line, locatorEdges);
		return [{
			lineIds: match?.lineIds || [lineId],
			title: locator?.title || String(line.text || '').trim(),
			titleKey: match?.titleKey || getTitleKey(locator?.title || line.text),
			...(Number.isInteger(match?.targetPage) && { targetPage: match.targetPage }),
			...(locator?.locatorKey && { locatorKey: locator.locatorKey }),
			linkDestinations: match?.linkDestinations
				|| getLinkedDestinations(line, links),
		}];
	});
	const heading = findVisualHeading(rows.map(row => {
		const firstLine = lines[row.lineIds[0]];
		const lastLine = lines[row.lineIds.at(-1)];
		return {
			...row,
			startOffset: getLineStartOffset(firstLine),
			endOffset: getLineEndOffset(lastLine),
		};
	}), lines, pageRect);
	return {
		headingLineIds: heading ? [getLineId(heading, lines.indexOf(heading))] : [],
		rows,
		source: 'heading-concentration',
	};
}

/** Confirm a navigation span from a dense, ordered repetition of body headings. */
export function detectContentsRegion(lines, pageRect, options = {}) {
	const state = getContentsPageState(lines, pageRect, options);
	return state && isConfirmedContentsRun([state])
		? buildContentsRegion(state)
		: null;
}

/** Confirm adjacent pages as one printed navigation object. */
export function detectContentsRegions(pages) {
	const regions = [];
	let run = [];
	function flush() {
		if (run.length && isConfirmedContentsRun(run)) {
			for (const state of run) {
				regions.push({ pageIndex: state.pageIndex, region: buildContentsRegion(state) });
			}
		}
		run = [];
	}
	for (const page of pages || []) {
		let state = getContentsPageState(page.lines, page.pageRect, {
			evidence: page.evidence,
			links: page.links,
			pageIndex: page.pageIndex,
		});
		// Do not let an adjacent page with one incidental repeated heading hitchhike
		// on a confirmed multi-page navigation object.
		if (
			state
			&& (
				state.matches.length < Math.ceil(MIN_MATCHED_HEADINGS / 2)
				|| (
					state.matches.length < MIN_MATCHED_HEADINGS
					&& !hasContentsPageDensity(state)
				)
			)
		) {
			state = null;
		}
		if (
			!state
			|| (
				run.length
				&& (
					state.pageIndex !== run.at(-1).pageIndex + 1
					|| state.matches[0].targetPage < run.at(-1).matches.at(-1).targetPage
				)
			)
		) {
			flush();
		}
		if (state) run.push(state);
	}
	flush();
	return regions;
}

function createBlockFromLineIds(source, lineIds, lines) {
	const selectedLines = lineIds.map(id => lines[id]).filter(Boolean);
	const startOffset = Math.min(...selectedLines.map((line, index) => (
		getLineStartOffset(line, index)
	)));
	const endOffset = Math.max(...selectedLines.map((line, index) => (
		getLineEndOffset(line, index)
	)));
	return {
		...source,
		lines: lineIds,
		bbox: unionRects(selectedLines) || source.bbox,
		startOffset,
		endOffset,
	};
}

function splitResidualBlock(block, claimedLineIds, lines, claimedOffsets) {
	if (!Array.isArray(block?.lines) || !block.lines.length) return [block];
	const remaining = block.lines
		.filter(lineId => lines[lineId] && !claimedLineIds.has(lineId))
		.sort((a, b) => getLineStartOffset(lines[a], a) - getLineStartOffset(lines[b], b));
	if (!remaining.length) return [];

	const groups = [];
	let group = [];
	let previousEnd = null;
	for (const lineId of remaining) {
		const start = getLineStartOffset(lines[lineId], lineId);
		if (
			group.length
			&& claimedOffsets.some(offset => offset > previousEnd && offset < start)
		) {
			groups.push(group);
			group = [];
		}
		group.push(lineId);
		previousEnd = getLineEndOffset(lines[lineId], lineId);
	}
	groups.push(group);
	return groups.map(lineIds => createBlockFromLineIds(block, lineIds, lines));
}

/** Replace every physical text row in a confirmed navigation span with a list item. */
export function normalizeContentsBlocks(blocks, lines, pageRect, options = {}) {
	const region = options.region || detectContentsRegion(lines, pageRect, options);
	if (!region?.rows?.length) return blocks;

	const entryLineIds = region.rows.flatMap(row => row.lineIds);
	const claimedLineIds = new Set(entryLineIds);
	const claimedOffsets = entryLineIds
		.map(lineId => getLineStartOffset(lines[lineId], lineId))
		.sort((a, b) => a - b);
	const contentsStartOffset = Math.min(...claimedOffsets);
	const contentsEndOffset = Math.max(...entryLineIds.map(lineId => (
		getLineEndOffset(lines[lineId], lineId)
	)));
	const normalized = (blocks || []).flatMap(block => (
		splitResidualBlock(block, claimedLineIds, lines, claimedOffsets)
	));
	for (const block of normalized) {
		if (block.startOffset >= contentsStartOffset && block.endOffset <= contentsEndOffset) {
			block.flowClass = 'auxiliary';
		}
		if (
			block.type === 'title'
			&& block.lines?.some(lineId => region.headingLineIds.includes(lineId))
		) {
			block.flowClass = 'auxiliary';
			block._contentsNavigationHeading = true;
		}
	}

	for (const row of region.rows) {
		normalized.push(createBlockFromLineIds({
			type: 'list_item',
			flowClass: 'auxiliary',
			_contentsList: true,
		}, row.lineIds, lines));
	}

	return normalized.sort((a, b) => (
		(a.startOffset ?? 0) - (b.startOffset ?? 0)
		|| (a.endOffset ?? 0) - (b.endOffset ?? 0)
	));
}
