import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	createContentsHeadingIndex,
	inferContentsPageLabels,
	detectContentsRegion,
	getContentsEvidence,
	normalizeContentsBlocks,
} from '../../src/pdf/structure/contents.js';
import { getOutline } from '../../src/pdf/structure/outline/outline.js';

const PAGE_RECT = [0, 0, 600, 800];

function makeLine(id, text, rect, startOffset = id * 100) {
	const tokens = text.split(/\s+/u).filter(Boolean);
	const totalLength = Math.max(1, tokens.reduce((sum, token) => sum + token.length, 0));
	let x = rect[0];
	const words = tokens.map(token => {
		const width = (rect[2] - rect[0]) * token.length / totalLength;
		const word = { text: token, rect: [x, rect[1], x + width, rect[3]] };
		x += width;
		return word;
	});
	return {
		id,
		text,
		rect,
		words,
		startOffset,
		endOffset: startOffset + Math.max(0, text.length - 1),
	};
}

function makeNavigationLine(id, title, locator, rect, startOffset = id * 100) {
	const line = makeLine(id, `${title} ${locator}`, rect, startOffset);
	const locatorWidth = Math.max(8, String(locator).length * 6);
	const locatorWord = line.words.at(-1);
	locatorWord.rect = [rect[2] - locatorWidth, rect[1], rect[2], rect[3]];
	const titleWidth = Math.max(1, rect[2] - rect[0] - locatorWidth - 40);
	const titleWords = line.words.slice(0, -1);
	const totalTitleLength = Math.max(1, titleWords.reduce((sum, word) => sum + word.text.length, 0));
	let x = rect[0];
	for (const word of titleWords) {
		const width = titleWidth * word.text.length / totalTitleLength;
		word.rect = [x, rect[1], x + width, rect[3]];
		x += width;
	}
	return line;
}

function makeInlineContents(rowCount = 6, heading = 'Contents') {
	const lines = [makeLine(0, heading, [60, 730, 140, 745], 0)];
	for (let i = 0; i < rowCount; i++) {
		lines.push(makeNavigationLine(
			i + 1,
			`${i + 1}. A sufficiently descriptive chapter title`,
			String(i + 3),
			[60, 700 - i * 20, 520, 712 - i * 20],
		));
	}
	return lines;
}

function makeOutlineBlock(type, text, pageIndex, fontName = 'Heading', fontSize = 18) {
	return {
		type,
		anchor: { pageRects: [[pageIndex, 60, 700, 500, 720]] },
		content: [{ text }],
		_metrics: {
			pageIndex,
			fontName,
			fontSize,
			firstCharFontName: fontName,
			firstCharFontSize: fontSize,
		},
	};
}

function flattenOutlineRefs(items) {
	return (items || []).flatMap(item => [
		...(Array.isArray(item.ref) ? [item.ref] : []),
		...flattenOutlineRefs(item.children),
	]);
}

function makeHeadingNodes(titles, firstTargetPage = 10) {
	return titles.map((title, index) => ({
		title,
		_pageIndex: firstTargetPage + index,
	}));
}

function makeInternalLinks(lines, firstTargetPage = 10) {
	return lines.map((line, index) => ({
		src: { rect: line.rect },
		dest: { pageIndex: firstTargetPage + index },
	}));
}

describe('PDF printed contents detection', () => {
	it('separates a confirmed title from a page label without whitespace', () => {
		const titles = ['First study', 'Second study', 'Third study', 'Fourth study'];
		const lines = titles.map((title, index) => makeLine(
			index, `${title}........${index + 10}`, [60, 700 - index * 20, 520, 714 - index * 20],
		));
		const evidence = getEvidence(lines, titles);

		assert.deepEqual(evidence.matches.map(match => match.locatorKey), ['10', '11', '12', '13']);
	});

	function getEvidence(lines, titles, firstTargetPage = 10, links = []) {
		const index = createContentsHeadingIndex(makeHeadingNodes(titles, firstTargetPage));
		return getContentsEvidence(lines, links, index, 0);
	}

	it('detects a dense ordered repetition of inferred body headings', () => {
		const lines = makeInlineContents();
		const titles = lines.slice(1).map(line => (
			line.words.slice(0, -1).map(word => word.text).join(' ')
		));
		const evidence = getEvidence(lines, titles);
		const region = detectContentsRegion(lines, PAGE_RECT, { evidence });

		assert.equal(region?.source, 'heading-concentration');
		assert.equal(region?.rows.length, 6);
	});

	it('matches wrapped contents entries as single navigation rows', () => {
		const titles = Array.from({ length: 4 }, (_, index) => (
			`${index + 1}. A sufficiently descriptive chapter title with continuation`
		));
		const lines = [makeLine(0, 'Contents', [60, 750, 140, 765], 0)];
		for (let index = 0; index < titles.length; index++) {
			lines.push(makeLine(
				lines.length,
				`${index + 1}. A sufficiently descriptive chapter title`,
				[60, 710 - index * 45, 430, 724 - index * 45],
			));
			lines.push(makeNavigationLine(
				lines.length,
				'with continuation',
				String(index + 10),
				[80, 690 - index * 45, 520, 704 - index * 45],
			));
		}
		const evidence = getEvidence(lines, titles);
		const region = detectContentsRegion(lines, PAGE_RECT, { evidence });

		assert.deepEqual(
			evidence.matches.map(match => match.lineIds),
			[[1, 2], [3, 4], [5, 6], [7, 8]],
		);
		assert.deepEqual(
			region?.rows.map(row => row.lineIds),
			[[1, 2], [3, 4], [5, 6], [7, 8]],
		);
	});

	it('matches contents entries spanning more than two physical lines', () => {
		const titles = Array.from({ length: 4 }, (_, index) => (
			`${index + 1}. A sufficiently descriptive chapter title with middle and final continuation`
		));
		const lines = [makeLine(0, 'Contents', [60, 750, 140, 765], 0)];
		for (let index = 0; index < titles.length; index++) {
			const top = 710 - index * 60;
			lines.push(makeLine(
				lines.length,
				`${index + 1}. A sufficiently descriptive chapter title`,
				[60, top, 430, top + 14],
			));
			lines.push(makeLine(
				lines.length,
				'with middle',
				[80, top - 18, 300, top - 4],
			));
			lines.push(makeNavigationLine(
				lines.length,
				'and final continuation',
				String(index + 10),
				[80, top - 36, 520, top - 22],
			));
		}
		const evidence = getEvidence(lines, titles);
		const region = detectContentsRegion(lines, PAGE_RECT, { evidence });

		assert.deepEqual(
			evidence.matches.map(match => match.lineIds),
			[[1, 2, 3], [4, 5, 6], [7, 8, 9], [10, 11, 12]],
		);
		assert.deepEqual(
			region?.rows.map(row => row.lineIds),
			[[1, 2, 3], [4, 5, 6], [7, 8, 9], [10, 11, 12]],
		);
	});

	it('retains short first fragments of confirmed wrapped entries', () => {
		const titles = Array.from({ length: 4 }, (_, index) => `${index + 1}. A sufficiently descriptive chapter title`);
		const lines = titles.flatMap((_, index) => [
			makeLine(index * 2, `${index + 1}.`, [60, 710 - index * 40, 90, 724 - index * 40]),
			makeNavigationLine(index * 2 + 1, 'A sufficiently descriptive chapter title', String(index + 10), [60, 694 - index * 40, 520, 708 - index * 40]),
		]);
		const evidence = getEvidence(lines, titles);
		const region = detectContentsRegion(lines, PAGE_RECT, { evidence });
		assert.deepEqual(region?.rows.map(row => row.lineIds), [[0, 1], [2, 3], [4, 5], [6, 7]]);
		assert.deepEqual(region?.rows.map(row => row.title), titles);
	});

	it('does not combine adjacent lines from separate columns', () => {
		const titles = Array.from({ length: 4 }, (_, index) => (
			`${index + 1}. Left-column title fragment with right-column continuation`
		));
		const lines = [];
		for (let index = 0; index < titles.length; index++) {
			const bottom = 700 - index * 24;
			lines.push(makeLine(
				lines.length,
				`${index + 1}. Left-column title fragment`,
				[60, bottom, 260, bottom + 14],
			));
			lines.push(makeLine(
				lines.length,
				'with right-column continuation',
				[340, bottom, 540, bottom + 14],
			));
		}

		assert.equal(getEvidence(lines, titles).matches.length, 0);
	});

	it('does not detect navigation without independent inferred headings', () => {
		assert.equal(detectContentsRegion(makeInlineContents(), PAGE_RECT), null);
	});

	it('requires at least four matching headings', () => {
		const lines = makeInlineContents(3);
		const titles = lines.slice(1).map(line => (
			line.words.slice(0, -1).map(word => word.text).join(' ')
		));
		const evidence = getEvidence(lines, titles);

		assert.equal(detectContentsRegion(lines, PAGE_RECT, { evidence }), null);
	});

	it('requires the matched body headings to preserve document order', () => {
		const lines = makeInlineContents(5);
		const titles = lines.slice(1).map(line => (
			line.words.slice(0, -1).map(word => word.text).join(' ')
		));
		const index = createContentsHeadingIndex(titles.map((title, index) => ({
			title,
			_pageIndex: 20 - index,
		})));
		const evidence = getContentsEvidence(lines, [], index, 0);

		assert.equal(detectContentsRegion(lines, PAGE_RECT, { evidence }), null);
	});

	it('rejects sparse repetitions spread through ordinary prose', () => {
		const titles = Array.from({ length: 4 }, (_, index) => `Independent heading ${index + 1}`);
		const lines = [makeLine(0, 'Page heading', [60, 760, 200, 775], 0)];
		for (let index = 0; index < titles.length; index++) {
			lines.push(makeNavigationLine(
				lines.length,
				titles[index],
				String(index + 2),
				[60, 700 - index * 100, 520, 714 - index * 100],
			));
			if (index !== titles.length - 1) {
				lines.push(makeLine(lines.length, 'First unrelated explanatory prose line', [60, 680 - index * 100, 500, 694 - index * 100]));
				lines.push(makeLine(lines.length, 'Second unrelated explanatory prose line', [60, 660 - index * 100, 500, 674 - index * 100]));
			}
		}
		const evidence = getEvidence(lines, titles);

		assert.equal(detectContentsRegion(lines, PAGE_RECT, { evidence }), null);
	});

	it('normalizes every physical row inside a confirmed span', () => {
		const titles = Array.from({ length: 4 }, (_, index) => `Matched chapter ${index + 1}`);
		const lines = [
			makeLine(0, 'Arbitrary navigation heading', [60, 750, 260, 766], 0),
			makeNavigationLine(1, titles[0], '2', [60, 710, 520, 724]),
			makeNavigationLine(2, 'Unmatched top-level entry', '7', [60, 690, 550, 704]),
			makeNavigationLine(3, titles[1], '9', [70, 670, 520, 684]),
			makeNavigationLine(4, titles[2], '12', [70, 650, 520, 664]),
			makeNavigationLine(5, 'Another unmatched row', '18', [60, 630, 550, 644]),
			makeNavigationLine(6, titles[3], '21', [70, 610, 520, 624]),
		];
		const evidence = getEvidence(lines, titles);
		const region = detectContentsRegion(lines, PAGE_RECT, { evidence });

		assert.equal(region?.rows.length, 6);
		assert.deepEqual(region?.rows.map(row => row.lineIds[0]), [1, 2, 3, 4, 5, 6]);
	});

	it('is independent of language and navigation-title wording', () => {
		const titles = ['第一章研究方法', '第二章实验结果', '第三章相关讨论', '第四章最终结论'];
		const lines = [
			makeLine(0, '任意の表題', [60, 730, 180, 745], 0),
			...titles.map((title, index) => makeNavigationLine(
				index + 1,
				title,
				String(index + 2),
				[60, 700 - index * 24, 520, 714 - index * 24],
			)),
		];
		const evidence = getEvidence(lines, titles);

		assert.equal(detectContentsRegion(lines, PAGE_RECT, { evidence })?.rows.length, 4);
	});

	it('does not use internal links as an independent detector', () => {
		const lines = makeInlineContents(6);
		const links = makeInternalLinks(lines.slice(1), 50);
		const evidence = getContentsEvidence(lines, links, createContentsHeadingIndex([]), 0);

		assert.equal(evidence.matches.length, 0);
		assert.equal(detectContentsRegion(lines, PAGE_RECT, { evidence }), null);
	});

	it('rejects ambiguous repeated body headings as evidence', () => {
		const repeatedTitle = 'A sufficiently descriptive chapter title';
		const lines = Array.from({ length: 4 }, (_, index) => makeNavigationLine(
			index,
			repeatedTitle,
			String(index + 2),
			[60, 700 - index * 24, 520, 714 - index * 24],
		));
		const index = createContentsHeadingIndex([
			{ title: repeatedTitle, _pageIndex: 10 },
			{ title: repeatedTitle, _pageIndex: 20 },
		]);
		const evidence = getContentsEvidence(lines, [], index, 0);

		assert.equal(evidence.matches.length, 0);
	});

	it('uses destination pages to disambiguate repeated titles without accepting conflicting links', () => {
		const title = 'A repeated section title';
		const lines = Array.from({ length: 4 }, (_, index) => makeNavigationLine(
			index, title, String(index + 10), [60, 700 - index * 24, 520, 714 - index * 24],
		));
		const headingIndex = createContentsHeadingIndex(lines.map((_, index) => ({ title, _pageIndex: index + 10 })));
		const links = makeInternalLinks(lines, 10);
		const evidence = getContentsEvidence(lines, links, headingIndex, 0);
		assert.deepEqual(evidence.matches.map(match => match.targetPage), [10, 11, 12, 13]);
		assert.equal(detectContentsRegion(lines, PAGE_RECT, { evidence, links })?.rows.length, 4);
		assert.equal(getContentsEvidence(lines, makeInternalLinks(lines, 20), headingIndex, 0).matches.length, 0);
	});

	it('does not use the empty space between annotation rectangles as linked text', () => {
		const line = makeLine(0, 'Independent heading', [60, 660, 300, 674]);
		const index = createContentsHeadingIndex([{ title: line.text, _pageIndex: 2 }]);
		const links = [{
			src: { rect: [60, 630, 300, 710], rects: [[60, 690, 300, 710], [60, 630, 300, 650]] },
			dest: { pageIndex: 3 },
		}];
		const evidence = getContentsEvidence([line], links, index, 0);
		assert.equal(evidence.matches.length, 1);
		assert.deepEqual(evidence.matches[0].linkDestinations, []);
	});

	it('extends confirmed contents through linked boundary rows but stops at surrounding prose', () => {
		const titles = Array.from({ length: 4 }, (_, index) => `Matched section ${index + 1}`);
		const rowTitles = ['Unmatched opening', ...titles, 'Unmatched closing'];
		const lines = [makeLine(0, 'Surrounding prose with an inline link', [60, 730, 520, 744])];
		for (const [index, title] of rowTitles.entries()) {
			lines.push(makeNavigationLine(index + 1, title, String(index + 2), [60, 710 - index * 20, 520, 724 - index * 20]));
		}
		lines.push(makeLine(7, 'Following prose with an inline link', [60, 590, 520, 604]));
		const links = makeInternalLinks(lines.slice(1, -1), 2);
		links.push({ src: { rect: lines[0].words[2].rect }, dest: { pageIndex: 1 } });
		links.push({ src: { rect: lines[7].words[2].rect }, dest: { pageIndex: 8 } });
		const index = createContentsHeadingIndex(makeHeadingNodes(titles, 3));
		const evidence = getContentsEvidence(lines, links, index, 0);
		const region = detectContentsRegion(lines, PAGE_RECT, { evidence, links, pageIndex: 0 });
		assert.deepEqual(region?.rows.map(row => row.lineIds[0]), [1, 2, 3, 4, 5, 6]);
		assert.deepEqual(region?.rows.map(row => row.title), rowTitles);
		assert.deepEqual(region?.rows.map(row => row.locatorKey), ['2', '3', '4', '5', '6', '7']);
		links[0].dest.pageIndex = 20;
		assert.deepEqual(detectContentsRegion(lines, PAGE_RECT, { evidence, links, pageIndex: 0 })?.rows.map(row => row.lineIds[0]), [2, 3, 4, 5, 6]);
	});

	it('normalizes accepted contents independently of the model block type', () => {
		const lines = [
			makeLine(0, 'Paper title', [60, 760, 300, 775], 0),
			...makeInlineContents().map((line, index) => ({
				...line,
				id: index + 1,
				startOffset: line.startOffset + 100,
				endOffset: line.endOffset + 100,
			})),
			makeLine(8, 'Main body after the contents.', [60, 520, 400, 535], 900),
		];
		const blocks = [{
			type: 'table',
			flowClass: 'body',
			lines: lines.map(line => line.id),
			bbox: [60, 520, 520, 775],
			startOffset: 0,
			endOffset: 930,
		}];

		const titles = lines.slice(2, 8).map(line => (
			line.words.slice(0, -1).map(word => word.text).join(' ')
		));
		const evidence = getEvidence(lines, titles);
		const region = detectContentsRegion(lines, PAGE_RECT, { evidence });
		const normalized = normalizeContentsBlocks(blocks, lines, PAGE_RECT, { region });

		assert.deepEqual(normalized.map(block => block.type), [
			'table',
			'list_item',
			'list_item',
			'list_item',
			'list_item',
			'list_item',
			'list_item',
			'table',
		]);
		assert.ok(normalized.slice(1, 7).every(block => (
			block.flowClass === 'auxiliary' && block._contentsList === true
		)));
		assert.deepEqual(normalized[0].lines, [0, 1]);
		assert.deepEqual(normalized.at(-1).lines, [8]);
	});

	it('marks the detected contents heading as auxiliary navigation', () => {
		const lines = makeInlineContents();
		const titles = lines.slice(1).map(line => (
			line.words.slice(0, -1).map(word => word.text).join(' ')
		));
		const blocks = [
			{
				type: 'title',
				flowClass: 'body',
				lines: [0],
				bbox: lines[0].rect,
				startOffset: lines[0].startOffset,
				endOffset: lines[0].endOffset,
			},
			{
				type: 'body',
				flowClass: 'body',
				lines: lines.slice(1).map(line => line.id),
				bbox: [60, 600, 520, 724],
				startOffset: lines[1].startOffset,
				endOffset: lines.at(-1).endOffset,
			},
		];
		const evidence = getEvidence(lines, titles);
		const region = detectContentsRegion(lines, PAGE_RECT, { evidence });
		const normalized = normalizeContentsBlocks(blocks, lines, PAGE_RECT, { region });
		const heading = normalized.find(block => block.type === 'title');

		assert.equal(heading?.flowClass, 'auxiliary');
		assert.equal(heading?._contentsNavigationHeading, true);
	});

	it('keeps printed contents entries from shadowing real outline targets', async () => {
		const blocks = [
			{
				type: 'heading',
				flowClass: 'auxiliary',
				_contentsNavigationHeading: true,
				anchor: { pageRects: [[0, 60, 700, 300, 720]] },
				content: [{ text: 'Chapter One' }],
			},
			{
				type: 'heading',
				anchor: { pageRects: [[10, 60, 700, 300, 720]] },
				content: [{ text: 'Chapter One' }],
			},
		];
		const nativeOutline = [{
			title: 'Chapter One',
			location: { position: { pageIndex: 10 } },
			items: [],
		}];

		const outline = await getOutline(blocks, [], null, nativeOutline);

		assert.equal(outline.length, 1);
		assert.deepEqual(outline[0].ref, [1]);
	});

	it('recovers an exact linked paragraph from confirmed printed contents', async () => {
		const blocks = [
			makeOutlineBlock('heading', 'First section', 1),
			makeOutlineBlock('paragraph', 'Body text', 1, 'Body', 10),
			makeOutlineBlock('heading', 'Second section', 2),
			makeOutlineBlock('paragraph', 'Body text', 2, 'Body', 10),
			makeOutlineBlock('paragraph', 'Recovered Heading', 3),
			makeOutlineBlock('paragraph', 'Body text', 3, 'Body', 10),
		];
		const outline = await getOutline(blocks, [], null, [], {
			navigationRegions: [{
				pageIndex: 0,
				source: 'heading-concentration',
				rows: [
					{ title: 'First section', linkDestinations: [{ pageIndex: 1, rect: [60, 700, 60, 700] }] },
					{ title: 'Second section', linkDestinations: [{ pageIndex: 2, rect: [60, 700, 60, 700] }] },
					{ title: 'Recovered H e a d i n g', linkDestinations: [{ pageIndex: 3, rect: [60, 700, 60, 700] }] },
				],
			}],
		});

		assert.ok(flattenOutlineRefs(outline).some(ref => ref[0] === 4));
	});

	it('does not globally exclude an auxiliary heading', async () => {
		const auxiliaryHeading = {
			...makeOutlineBlock('heading', 'Recovered Heading', 3),
			flowClass: 'auxiliary',
		};
		const blocks = [
			makeOutlineBlock('heading', 'First section', 1),
			makeOutlineBlock('heading', 'Second section', 2),
			auxiliaryHeading,
		];
		const withoutNavigation = await getOutline(blocks, [], null, []);
		const withNavigation = await getOutline(blocks, [], null, [], {
			navigationRegions: [{
				pageIndex: 0,
				source: 'heading-concentration',
				rows: [
					{ title: 'First section', linkDestinations: [{ pageIndex: 1, rect: [60, 700, 60, 700] }] },
					{ title: 'Second section', linkDestinations: [{ pageIndex: 2, rect: [60, 700, 60, 700] }] },
					{ title: 'Recovered Heading', linkDestinations: [{ pageIndex: 3, rect: [60, 700, 60, 700] }] },
				],
			}],
		});

		assert.ok(flattenOutlineRefs(withoutNavigation).some(ref => ref[0] === 2));
		assert.ok(flattenOutlineRefs(withNavigation).some(ref => ref[0] === 2));
	});




	it('does not add a navigation heading from native-outline agreement alone', async () => {
		const navigationHeading = {
			...makeOutlineBlock('heading', 'Navigation', 0),
			_contentsNavigationHeading: true,
		};
		navigationHeading._metrics.fontName = 'Body';
		const blocks = [
			navigationHeading,
			makeOutlineBlock('heading', 'First section', 1),
			makeOutlineBlock('heading', 'Second section', 2),
		];
		const nativeOutline = [{
			title: 'Navigation',
			location: { position: { pageIndex: 0 } },
			items: [],
		}];
		const withoutNative = await getOutline(blocks, [], null, []);
		const withNative = await getOutline(blocks, [], null, nativeOutline);

		assert.ok(!flattenOutlineRefs(withoutNative).some(ref => ref[0] === 0));
		assert.ok(!flattenOutlineRefs(withNative).some(ref => ref[0] === 0));
	});

	it('turns unmatched group headings inside a confirmed span into list items', () => {
		const lines = [makeLine(0, 'Contents', [60, 730, 140, 745], 0)];
		const titles = [];
		for (let i = 0; i < 3; i++) {
			const title = `Opening chapter title ${i + 1}`;
			titles.push(title);
			lines.push(makeNavigationLine(
				i + 1,
				title,
				String(i + 1),
				[60, 700 - i * 20, 520, 712 - i * 20],
			));
		}
		lines.push(makeLine(4, 'Part Two: A group heading', [60, 630, 300, 642]));
		for (let i = 0; i < 3; i++) {
			const title = `Later chapter title ${i + 1}`;
			titles.push(title);
			lines.push(makeNavigationLine(
				i + 5,
				title,
				String(i + 10),
				[60, 600 - i * 20, 520, 612 - i * 20],
			));
		}
		const blocks = [{
			type: 'body',
			flowClass: 'body',
			lines: lines.map(line => line.id),
			bbox: [60, 560, 520, 745],
			startOffset: 0,
			endOffset: lines.at(-1).endOffset,
		}];

		const evidence = getEvidence(lines, titles);
		const region = detectContentsRegion(lines, PAGE_RECT, { evidence });
		const normalized = normalizeContentsBlocks(blocks, lines, PAGE_RECT, { region });
		const groupHeading = normalized.find(block => block.lines?.includes(4));

		assert.ok(groupHeading);
		assert.equal(groupHeading.type, 'list_item');
		assert.equal(groupHeading.flowClass, 'auxiliary');
	});
});


describe('Contents evidence to outline contract', () => {
	it('preserves a printed numeric label when the destination title has none', () => {
		const index = createContentsHeadingIndex([{ title: 'Basic concepts', _pageIndex: 8 }]);
		const lines = [makeLine(0, '1 Basic concepts 1', [60, 700, 400, 715])];
		const evidence = getContentsEvidence(lines, [], index, 2);
		assert.equal(evidence.matches.length, 1);
		assert.equal(evidence.matches[0].title, '1 Basic concepts');
		assert.equal(evidence.matches[0].locatorKey, '1');
		assert.equal(evidence.matches[0].targetPage, 8);
	});

	it('does not normalize repeated title and credit pages as contents', () => {
		const titles = ['Lecture notes', 'Probability theory', 'Edited by the authors', 'University department'];
		const index = createContentsHeadingIndex(titles.map(title => ({ title, _pageIndex: 20 })));
		const lines = titles.map((title, i) => makeLine(i, title, [60, 700 - i * 20, 400, 715 - i * 20]));
		const evidence = getContentsEvidence(lines, [], index, 0);
		assert.equal(evidence.matches.length, 4);
		assert.equal(detectContentsRegion(lines, PAGE_RECT, { pageIndex: 0, evidence }), null);
	});

	it('joins linked title fragments even when the final fragment matches independently', () => {
		const blocks = [{}, {}];
		const index = createContentsHeadingIndex([
			{ title: 'Detailed experimental measurements', _pageIndex: 3, _requiresLink: true, _sourceBlocks: blocks },
			{ title: 'measurements', _pageIndex: 3, _requiresLink: true, _sourceBlocks: [blocks[1]] },
		]);
		const lines = [makeLine(0, 'Detailed experimental', [60, 700, 400, 715]), makeLine(1, 'measurements 4', [60, 684, 400, 699])];
		const links = lines.map(line => ({ src: { rect: line.rect }, dest: { pageIndex: 3, rect: [60, 720, 60, 720] } }));
		const evidence = getContentsEvidence(lines, links, index, 0);
		assert.equal(evidence.matches.length, 1);
		assert.equal(evidence.matches[0].title, 'Detailed experimental measurements');
		assert.deepEqual(evidence.matches[0].lineIds, [0, 1]);
	});

	it('requires linked locators before paragraph text can confirm contents', () => {
		const titles = ['Alpha measurements', 'Beta measurements', 'Gamma measurements', 'Delta measurements'];
		const index = createContentsHeadingIndex(titles.map((title, i) => ({ title, _pageIndex: i + 1, _requiresLink: true })));
		const lines = titles.map((title, i) => makeLine(i, `${title} ${i + 1}`, [60, 700 - i * 20, 400, 715 - i * 20]));
		const links = lines.map((line, i) => ({ src: { rect: line.rect }, dest: { pageIndex: i + 1 } }));
		assert.equal(getContentsEvidence(lines, [], index, 0).matches.length, 0);
		const evidence = getContentsEvidence(lines, links, index, 0);
		assert.equal(evidence.matches.length, 4);
		assert.ok(detectContentsRegion(lines, PAGE_RECT, { pageIndex: 0, links, evidence }));
		const prose = lines.map((line, i) => ({ ...line, text: titles[i] + ' and more' }));
		assert.equal(getContentsEvidence(prose, links, index, 0).matches.length, 0);
	});

	it('infers missing page labels only from independent consistent anchors', () => {
		const rows = [1, 3, 6, 8].map(number => ({ locatorKey: String(number), targetPage: number + 2 }));
		const labels = Array(15).fill('-');
		assert.ok(inferContentsPageLabels([{ rows }], labels)[7].has('5'));
		assert.ok(!inferContentsPageLabels([{ rows: rows.slice(1) }], labels)[7].has('5'));
		assert.ok(!inferContentsPageLabels([{ rows: [...rows, { locatorKey: '9', targetPage: 12 }] }], labels)[7].has('5'));
		assert.ok(!inferContentsPageLabels([{ rows: Array(4).fill(rows[0]) }], labels)[7].has('5'));
	});

	it('does not count overlapping heading compositions as independent evidence', () => {
		const sourceBlocks = [{}, {}, {}];
		const candidates = [
			{ title: 'Composite section', _sourceBlocks: sourceBlocks.slice(0, 1) },
			{ title: 'Composite section and methods', _sourceBlocks: sourceBlocks.slice(0, 2) },
			{ title: 'Composite section and methods measurements', _sourceBlocks: sourceBlocks },
			{ title: 'and methods', _sourceBlocks: sourceBlocks.slice(1, 2) },
		];
		const lines = candidates.map(({ title }, i) => makeLine(i, title, [60, 700 - i * 20, 400, 715 - i * 20]));
		const index = createContentsHeadingIndex(candidates.map(node => ({ ...node, _pageIndex: 1 })));
		const evidence = getContentsEvidence(lines, [], index, 0);
		assert.equal(evidence.matches.length, 2);
		assert.equal(detectContentsRegion(lines, PAGE_RECT, { pageIndex: 0, evidence }), null);
	});

	it('retains detected navigation when title-only contents has no resolvable locators', async () => {
		const titles = ['Alpha analysis', 'Beta analysis', 'Gamma analysis', 'Delta analysis'];
		const index = createContentsHeadingIndex(titles.map((title, i) => ({ title, _pageIndex: i + 1 })));
		const lines = titles.map((title, i) => makeLine(i, title, [60, 700 - i * 20, 300, 715 - i * 20]));
		const evidence = getContentsEvidence(lines, [], index, 0);
		const region = detectContentsRegion(lines, PAGE_RECT, { pageIndex: 0, evidence });
		assert.ok(region);
		const blocks = titles.map((title, i) => makeOutlineBlock('heading', title, i + 1));
		assert.deepEqual(await getOutline(blocks, [], null, [], {
			navigationRegions: [{ ...region, pageIndex: 0 }],
		}), await getOutline(blocks, [], null, []));
	});
});
