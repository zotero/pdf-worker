import { applyTextAttributes } from '../../../structured-document-text/src/pdf/index.js';

function sameRef(a, b) {
	if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
		return false;
	}
	for (let i = 0; i < a.length; i++) {
		if (a[i] !== b[i]) {
			return false;
		}
	}
	return true;
}

function getNodeByRef(structure, ref) {
	if (!structure || !Array.isArray(ref)) {
		return null;
	}
	let node = { content: structure.content };
	for (const index of ref) {
		if (!node || !Array.isArray(node.content)) {
			return null;
		}
		node = node.content[index];
		if (!node || typeof node !== 'object') {
			return null;
		}
	}
	return node;
}

function getTextNodeRefForOffset(structure, blockRef, charOffset) {
	const block = getNodeByRef(structure, blockRef);
	if (!block) return null;
	let currentOffset = 0;
	let result = null;
	const walk = (node, path) => {
		if (result) return;
		if (typeof node?.text === 'string') {
			if (charOffset < currentOffset + node.text.length) {
				result = [...blockRef, ...path];
				return;
			}
			currentOffset += node.text.length;
			return;
		}
		if (Array.isArray(node?.content)) {
			for (let i = 0; i < node.content.length; i++) {
				walk(node.content[i], [...path, i]);
				if (result) return;
			}
		}
	};
	walk(block, []);
	return result || blockRef;
}

function addRef(node, refToAdd, field = 'refs') {
	if (!node || !Array.isArray(refToAdd)) {
		return node;
	}
	const refs = Array.isArray(node[field]) ? node[field].slice() : [];
	if (!refs.some((ref) => sameRef(ref, refToAdd))) {
		refs.push(refToAdd.slice());
	}
	return {
		...node,
		[field]: refs
	};
}

function applyRefToText(structure, target, refToAdd) {
	if (!target?.blockRef) {
		return null;
	}
	return applyTextAttributes(
		structure,
		target.blockRef,
		target.offsetStart,
		target.offsetEnd,
		(node) => addRef(node, refToAdd)
	);
}

function applyRefToBlock(structure, blockRef, refToAdd, field = 'refs') {
	const node = getNodeByRef(structure, blockRef);
	if (!node) {
		return null;
	}
	const updated = addRef(node, refToAdd, field);
	Object.assign(node, updated);
	return blockRef;
}

export function applyRefs(structure, refsList) {
	if (!structure || !refsList) {
		return;
	}

	const groups = refsList instanceof Map ? refsList.values() : [refsList];
	const pendingBackRefs = [];

	// Phase 1: Forward refs + URL targets (splits source blocks only)
	for (const group of groups) {
		if (!Array.isArray(group) || group.length === 0) {
			continue;
		}
		for (const entry of group) {
			// URL-only entry: apply target to source text node
			if (entry?.url && entry?.src?.blockRef
				&& (!entry?.dest || !entry?.dest?.blockRef)) {
				applyTextAttributes(structure, entry.src.blockRef,
					entry.src.offsetStart, entry.src.offsetEnd,
					(node) => ({ ...node, target: { url: entry.url } }));
				continue;
			}

			if (!entry?.src?.blockRef || !entry?.dest?.blockRef) {
				continue;
			}

			const destRef = entry.dest.blockRef.slice();

			// Forward ref on source text node
			applyRefToText(structure, entry.src, destRef)
				|| applyRefToBlock(structure, entry.src.blockRef, destRef);

			// Record for Phase 2 backRef resolution
			pendingBackRefs.push({
				sourceBlockRef: entry.src.blockRef,
				sourceCharOffset: entry.src.offsetStart,
				dest: entry.dest,
			});
		}
	}

	// Phase 2: Resolve source refs from final state, apply block-level backRefs
	for (const pending of pendingBackRefs) {
		const sourceRef = getTextNodeRefForOffset(
			structure, pending.sourceBlockRef, pending.sourceCharOffset);
		if (!sourceRef) {
			continue;
		}
		applyRefToBlock(structure, pending.dest.blockRef, sourceRef, 'backRefs');
	}
}
