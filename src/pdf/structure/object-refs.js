import { citationSourceParts, citationTextUnits } from './citation-text.js';
import { createStructureIndex } from './structure-index.js';

const LABELS = new Map([
	['figure', 'figure'], ['fig', 'figure'],
	['photograph', 'photograph'], ['photo', 'photograph'],
	['illustration', 'illustration'], ['illus', 'illustration'],
	['table', 'table'], ['tbl', 'table'],
	['equation', 'math'], ['eq', 'math'],
	['example', 'example'], ['ex', 'example'],
]);
const IDENTIFIER = '(?:[A-Za-z]\\.?)?\\d+(?:\\.\\d+)*[A-Za-z]?';
const MENTION = new RegExp(
	`\\b(${[...LABELS.keys()].join('|')})s?\\.?\\s+(?:\\((${IDENTIFIER})\\)|(${IDENTIFIER}))(?![\\p{L}\\p{N}_]|\\.[\\p{L}\\p{N}])`,
	'giu',
);
const EQUATION_LABEL = new RegExp(`\\s+\\((${IDENTIFIER})\\)\\s*$`, 'u');
const PANEL_LABEL_RE = /(?:^|[.!?:|;]\s+)(?:[A-Za-z][,.:)]\s|\([A-Za-z]\)\s)/u;

function addTarget(targets, key, ref) {
	if (!targets.has(key)) targets.set(key, []);
	targets.get(key).push(ref);
}

function labelKey(match) {
	return `${LABELS.get(match[1].toLowerCase())}:${match[2] || match[3]}`;
}

function getTargets(structure, index) {
	const targets = new Map();
	for (const { ref, block } of index.blockEntries()) {
		if ((block.flowClass || structure.content[ref[0]].flowClass) === 'excluded'
			|| !['caption', 'math'].includes(block.type)) continue;
		index.withBlockText(ref, bt => {
			if (block.type === 'caption') {
				const match = bt.text.matchAll(MENTION).next().value;
				if (match && !bt.text.slice(0, match.index).trim()) {
					addTarget(targets, labelKey(match), ref);
				}
				return;
			}
			const match = bt.text.match(EQUATION_LABEL);
			if (!match) return;
			const start = match.index + match[0].indexOf('(');
			const labelRects = bt.rects.slice(start).filter(Boolean);
			const formulaRects = bt.rects.slice(0, match.index).filter(Boolean);
			if (!labelRects.length || !formulaRects.length) return;
			const left = Math.min(...labelRects.map(r => r[0]));
			const height = Math.max(...labelRects.map(r => r[3] - r[1]));
			const formulaRight = Math.max(...formulaRects.map(r => r[2]));
			// A label must be detached from the formula, not a final function argument.
			if (left - formulaRight > height) addTarget(targets, `math:${match[1]}`, ref);
		});
	}
	return targets;
}

export function addObjectRefs(structure, refs, index = createStructureIndex(structure)) {
	const targets = getTargets(structure, index);
	for (const [key, links] of refs) {
		if (!links.some(link => link.destinationResolution === 'source-text')) continue;
		index.withBlockText(key.split(',').map(Number), bt => {
			const mentions = [...bt.text.matchAll(MENTION)];
			// Source-text lookup can resolve an authored object link to prose that
			// merely mentions it. That is not a corroborated object destination.
			refs.set(key, links.filter(link => {
				if (link.destinationResolution !== 'source-text') return true;
				const text = bt.text.slice(link.src.offsetStart, link.src.offsetEnd + 1)
					.replace(/[^\p{L}\p{N}]+$/u, '');
				const mention = mentions.find(match => link.src.offsetStart >= match.index
					&& link.src.offsetStart + text.length <= match.index + match[0].length);
				if (!mention) return true;
				const type = LABELS.get(mention[1].toLowerCase());
				const destType = index.getBlock(link.dest.blockRef)?.type;
				return type === 'math' ? destType === 'math'
					: destType === 'caption' || destType === (type === 'table' ? 'table' : 'image');
			}));
		});
	}
	const include = (ref, block) => ['paragraph', 'caption', 'listitem'].includes(block.type) && !block.reference
		&& (block.flowClass || structure.content[ref[0]].flowClass) !== 'excluded';
	for (const { blockRef, bt, parts, links } of citationTextUnits(structure, index, include, refs)) {
		const destinations = new Set(links.filter(link => link.dest?.blockRef)
			.map(link => link.dest.blockRef.join(',')));
		for (const match of bt.text.matchAll(MENTION)) {
			const key = labelKey(match);
			let matches = targets.get(key);
			if (!matches && !key.startsWith('math:') && /[0-9][A-Za-z]$/u.test(key)) {
				matches = targets.get(key.slice(0, -1));
				// A panel-to-parent fallback needs a caption describing panels.
				if (matches?.length === 1 && !index.withBlockText(matches[0], bt => PANEL_LABEL_RE.test(bt.text))) continue;
			}
			if (matches?.length !== 1) continue;
			const dest = matches[0];
			if (destinations.has(dest.join(','))) continue;
			const start = match.index;
			const end = start + match[0].length - 1;
			if (bt.attrs.slice(start, end + 1).some(attr => attr?.style?.monospace || attr?.style?.sup)
				|| links.some(link => link.dest?.blockRef
					&& start <= link.src.offsetEnd && link.src.offsetStart <= end)) continue;
			const sources = citationSourceParts({ blockRef, offsetStart: start, offsetEnd: end }, parts);
			if (sources.some(src => src.blockRef.join(',') === dest.join(','))) continue;
			for (const src of sources) {
				const key = src.blockRef.join(',');
				if (!refs.has(key)) refs.set(key, []);
				refs.get(key).push({ src, dest: { blockRef: dest } });
			}
			destinations.add(dest.join(','));
		}
	}
}
