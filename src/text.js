
function rectsDist([ax1, ay1, ax2, ay2], [bx1, by1, bx2, by2]) {
	let left = bx2 < ax1;
	let right = ax2 < bx1;
	let bottom = by2 < ay1;
	let top = ay2 < by1;

	if (top && left) {
		return Math.hypot(ax1 - bx2, ay2 - by1);
	}
	else if (left && bottom) {
		return Math.hypot(ax1 - bx2, ay1 - by2);
	}
	else if (bottom && right) {
		return Math.hypot(ax2 - bx1, ay1 - by2);
	}
	else if (right && top) {
		return Math.hypot(ax2 - bx1, ay2 - by1);
	}
	else if (left) {
		return ax1 - bx2;
	}
	else if (right) {
		return bx1 - ax2;
	}
	else if (bottom) {
		return ay1 - by2;
	}
	else if (top) {
		return by1 - ay2;
	}

	return 0;
}

function getClosestOffset(chars, rect) {
	let dist = Infinity;
	let idx = 0;
	for (let i = 0; i < chars.length; i++) {
		let ch = chars[i];
		let distance = rectsDist(ch.rect, rect);
		if (distance < dist) {
			dist = distance;
			idx = i;
		}
	}
	return idx;
}

function quickIntersectRect(r1, r2) {
	return !(r2[0] > r1[2]
		|| r2[2] < r1[0]
		|| r2[1] > r1[3]
		|| r2[3] < r1[1]);
}

function getCenterRect(r) {
	return [
		r[0] + (r[2] - r[0]) / 2,
		r[1] + (r[3] - r[1]) / 2,
		r[0] + (r[2] - r[0]) / 2,
		r[1] + (r[3] - r[1]) / 2
	];
}

function getRangeByHighlight(structuredText, rects) {
	let chars = flattenChars(structuredText);
	if (!chars.length) {
		return null;
	}
	let anchorOffset = Infinity;
	for (let i = 0; i < chars.length; i++) {
		let char = chars[i];
		if (quickIntersectRect(getCenterRect(char.rect), rects[0])) {
			anchorOffset = i;
			break;
		}
	}
	let headOffset = 0;
	for (let i = chars.length - 1; i >= 0; i--) {
		let char = chars[i];
		if (quickIntersectRect(getCenterRect(char.rect), rects[rects.length - 1])) {
			headOffset = i;
			break;
		}
	}

	headOffset++;

	if (anchorOffset > headOffset) {
		return null;
	}

	let range = getRange(structuredText, anchorOffset, headOffset);
	range.offset = range.anchorOffset;
	range.from = range.anchorOffset;
	range.to = range.headOffset;
	// delete range.anchorOffset;
	// delete range.headOffset;
	return range;
}

function getLineSelectionRect(line, charFrom, charTo) {
	if ([90, 270].includes(line.words.at(-1).chars.at(-1).rotation)) {
		return [
			line.rect[0],
			Math.min(charFrom.rect[1], charTo.rect[1]),
			line.rect[2],
			Math.max(charFrom.rect[3], charTo.rect[3])
		];
	}
	else {
		return [
			Math.min(charFrom.rect[0], charTo.rect[0]),
			line.rect[1],
			Math.max(charFrom.rect[2], charTo.rect[2]),
			line.rect[3]
		];
	}
}

function getRange(structuredText, anchorOffset, headOffset) {
	let charStart;
	let charEnd;
	if (anchorOffset < headOffset) {
		charStart = anchorOffset;
		charEnd = headOffset - 1;
	}
	else if (anchorOffset > headOffset) {
		charStart = headOffset;
		charEnd = anchorOffset - 1;
	}
	else {
		return { collapsed: true, anchorOffset, headOffset, rects: [], text: '' };
	}

	// Get text
	let text = [];
	let extracting = false;

	let { paragraphs } = structuredText;

	let n = 0;

	loop1: for (let paragraph of paragraphs) {
		for (let line of paragraph.lines) {
			for (let word of line.words) {
				for (let char of word.chars) {
					if (n === charStart) {
						extracting = true;
					}
					if (extracting) {
						text.push(char.c);
					}
					if (n === charEnd) {
						break loop1;
					}
					n++;
				}
				if (extracting && word.spaceAfter) {
					text.push(' ');
				}
			}
			if (line !== paragraph.lines.at(-1)) {
				if (line.hyphenated) {
					text.pop();
				}
				else {
					text.push(' ');
				}
			}
		}
	}
	text = text.join('').trim();
	// Get rects
	extracting = false;
	let rects = [];
	n = 0;
	loop2: for (let paragraph of paragraphs) {
		for (let line of paragraph.lines) {
			let charFrom = null;
			let charTo = null;
			for (let word of line.words) {
				for (let char of word.chars) {
					if (n === charStart || extracting && !charFrom) {
						charFrom = char;
						extracting = true;
					}
					if (extracting) {
						charTo = char;
						if (n === charEnd) {
							rects.push(getLineSelectionRect(line, charFrom, charTo));
							break loop2;
						}
					}
					n++;
				}
			}
			if (extracting && charFrom && charTo) {
				rects.push(getLineSelectionRect(line, charFrom, charTo));
				charFrom = null;
			}
		}
	}

	rects = rects.map(rect => rect.map(value => parseFloat(value.toFixed(3))));
	return { anchorOffset, headOffset, rects, text };
}

function flattenChars(structuredText) {
	let flatCharsArray = [];
	for (let paragraph of structuredText.paragraphs) {
		for (let line of paragraph.lines) {
			for (let word of line.words) {
				for (let charObj of word.chars) {
					flatCharsArray.push(charObj);
				}
			}
		}
	}
	return flatCharsArray;
}

module.exports = {
	getClosestOffset,
	getRangeByHighlight,
	flattenChars
};
