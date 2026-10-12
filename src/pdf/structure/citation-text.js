import {
	getPartChain,
	getPartBoundarySeparator,
	shouldDropHardHyphenAtPartBoundary,
} from '../../../structured-document-text/src/parts.js';

// Scan existing logical continuations without changing physical SDT ownership.
export function* citationTextUnits(structure, structureIndex, include, citationLinks) {
	const seen = new Set();
	for (const entry of structureIndex.blockEntries()) {
		if (seen.has(entry.key) || !include(entry.ref, entry.block)) continue;
		let chain = getPartChain(structure, entry.ref, {
			include: (ref, block) => !seen.has(ref.join(',')) && include(ref, block),
		});
		if (!chain.length) chain = [entry];
		const parts = [];
		const links = [];
		let bt = { text: '', attrs: [], rects: [], pageIndexes: [] };
		for (let i = 0; i < chain.length; i++) {
			const { ref, block } = chain[i];
			seen.add(ref.join(','));
			const text = structureIndex.withBlockText(ref, text => text);
			if (chain.length === 1) {
				bt = text;
				links.push(...(citationLinks?.get(ref.join(',')) || []));
				break;
			}
			if (i > 0) {
				const previous = chain[i - 1].block;
				if (shouldDropHardHyphenAtPartBoundary(previous, block) && bt.text.endsWith('-')) {
					bt.text = bt.text.slice(0, -1);
					for (const key of ['attrs', 'rects', 'pageIndexes']) bt[key].pop();
					parts.at(-1).length--;
				}
				const separator = getPartBoundarySeparator(previous, block);
				bt.text += separator;
				for (const key of ['attrs', 'rects', 'pageIndexes']) {
					bt[key].push(...Array(separator.length).fill(null));
				}
			}
			const start = bt.text.length;
			parts.push({ blockRef: ref, start, length: text.text.length });
			for (const link of citationLinks?.get(ref.join(',')) || []) {
				links.push({ ...link, src: { ...link.src,
					offsetStart: start + link.src.offsetStart, offsetEnd: start + link.src.offsetEnd,
				} });
			}
			bt.text += text.text;
			for (const key of ['attrs', 'rects', 'pageIndexes']) bt[key] = bt[key].concat(text[key]);
		}
		yield { blockRef: chain[0].ref, block: chain[0].block, bt, parts, links };
	}
}

export function citationSourceParts(source, parts) {
	if (!parts?.length) return [source];
	return parts.flatMap(part => {
		const offsetStart = Math.max(source.offsetStart, part.start) - part.start;
		const offsetEnd = Math.min(source.offsetEnd, part.start + part.length - 1) - part.start;
		return offsetStart <= offsetEnd ? [{ blockRef: part.blockRef, offsetStart, offsetEnd }] : [];
	});
}
