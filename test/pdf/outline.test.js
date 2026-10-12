import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getNativeOutline, getOutline } from '../../src/pdf/structure/outline/outline.js';

function heading(title, pageIndex, fontSize = 12, fontName = 'Heading') {
	return {
		type: 'heading',
		content: [{ text: title }],
		anchor: { pageRects: [[pageIndex, 60, 700, 500, 720]] },
		_metrics: { fontName, fontSize },
	};
}

describe('PDF outline hierarchy', () => {
	it('preserves a sole native parent and URL hierarchy through ingestion', async () => {
		const source = [{ title: 'Resources', unsafeUrl: 'https://example.org', items: [
			{ title: 'First resource', unsafeUrl: 'https://example.org/one' },
			{ title: 'Second resource', unsafeUrl: 'https://example.org/two' },
		] }];
		const native = await getNativeOutline({ pdfManager: { ensureCatalog: async () => source } });
		assert.deepEqual(await getOutline([], [], null, native), [{
			title: 'Resources', source: 'native', target: { url: 'https://example.org' }, children: [
				{ title: 'First resource', source: 'native', target: { url: 'https://example.org/one' } },
				{ title: 'Second resource', source: 'native', target: { url: 'https://example.org/two' } },
			],
		}]);
	});

	it('retains an authored destination when its heading matches on the following page', async () => {
		const position = { pageIndex: 0, rect: [60, 750, 60, 750] };
		assert.deepEqual(await getOutline([heading('Main study', 1)], [], null, [{
			title: 'Main study', location: { position }, items: [],
		}]), [{ title: 'Main study', source: 'native', ref: [0], target: { position } }]);
	});

	it('falls back to detected headings when printed contents resolves no entries', async () => {
		const blocks = ['1 First study', '2 Second study', '3 Third study'].map((title, i) => heading(title, i + 1));
		const baseline = await getOutline(blocks, [], null, []);
		assert.ok(baseline.length);
		assert.deepEqual(await getOutline(blocks, [], null, [], {
			pageLabels: ['', '1', '2', '3'],
			navigationRegions: [{ source: 'heading-concentration', pageIndex: 0, rows: [
				{ title: 'Unresolved entry', locatorKey: '1' },
			] }],
		}), baseline);
	});

	it('preserves explicit section depth when numbered heading levels share one style', async () => {
		const titles = ['3 Main study', '3.1 Measurements', '3.1.1 Sampling', '3.1.2 Analysis', '3.2 Results', '4 Discussion'];
		const blocks = [heading('Study overview', 0, 20), ...titles.map((title, i) => heading(title, i + 1))];
		const outline = await getOutline(blocks, [], null, []);
		assert.deepEqual(outline, [{ title: 'Study overview', ref: [0] }, {
			title: titles[0], ref: [1], children: [
				{ title: titles[1], ref: [2], children: [
					{ title: titles[2], ref: [3] }, { title: titles[3], ref: [4] },
				] }, { title: titles[4], ref: [5] },
			],
		}, { title: titles[5], ref: [6] }]);
	});

	it('does not replace authored contents destinations with conflicting printed page labels', async () => {
		const destination = { pageIndex: 2, rect: [60, 720, 60, 720] };
		const blocks = [heading('Further study', 1)];
		for (const inferredTarget of [undefined, 1]) {
			assert.deepEqual(await getOutline(blocks, [], null, [], {
				pageLabels: ['', '1', '2'],
				navigationRegions: [{ pageIndex: 0, source: 'heading-concentration', rows: [{
					title: 'Further study', locatorKey: '1', targetPage: inferredTarget,
					linkDestinations: [destination],
				}] }],
			}), [
				{ title: 'Further study', target: { position: destination } },
			]);
		}
	});

	it('omits figure-list rows without dropping target-only section navigation', async () => {
		const section = { pageIndex: 3, rect: [60, 720, 60, 720] };
		const blocks = [heading('Main study', 1), { ...heading('Figure 1. Results', 2), type: 'caption' }];
		const options = { pageLabels: ['', '1', '2', '3'], navigationRegions: [{
			pageIndex: 0, source: 'heading-concentration', rows: [
				{ title: 'Main study', linkDestinations: [{ pageIndex: 1 }] },
				{ title: 'Figure 1. Results........2', titleKey: 'figure1results2', linkDestinations: [{ pageIndex: 2 }] },
				{ title: 'Further study', linkDestinations: [section] },
			],
		}] };
		assert.deepEqual(await getOutline(blocks, [], null, [], options), [
			{ title: 'Main study', ref: [0] },
			{ title: 'Further study', target: { position: section } },
		]);
		options.navigationRegions[0].rows = options.navigationRegions[0].rows.slice(1, 2);
		assert.deepEqual(await getOutline(blocks, [], null, [], options), await getOutline(blocks, [], null, []));
	});

	it('keeps printed contents flat across indentation and columns', async () => {
		for (const layout of ['left', 'columns', 'right']) {
			const titles = ['Main study', 'Measurements', 'Sampling', 'Appendix notes', 'Additional measurements'];
			const blocks = titles.map((title, index) => heading(title, index + 1));
			const rows = titles.map((title, index) => {
				const indent = [0, 20, 40, 0, 20][index];
				const column = layout === 'columns' && index >= 3;
				const x = (column ? 320 : 60) + indent;
				const y = 700 - (column ? index - 3 : index) * 20;
				return { title, targetPage: index + 1, locatorKey: String(index + 1), rect: layout === 'right' ? [x + index * 10, y, 520 - indent, y + 12] : [x, y, x + 200, y + 12] };
			});
			const outline = await getOutline(blocks, [], null, [], {
				pageLabels: ['', '1', '2', '3', '4', '5'],
				navigationRegions: [{ source: 'heading-concentration', rows }],
			});

			assert.deepEqual(outline, titles.map((title, index) => ({ title, ref: [index] })));
		}
	});

	it('recovers repeated titles and missed headings from a confirmed contents page', async () => {
		const blocks = [
			heading('Repeated section', 1),
			heading('Repeated section', 2),
			{ ...heading('Further study', 3), type: 'paragraph' },
			heading('Ambiguous section', 4),
			heading('Ambiguous section', 4),
			heading('Ambiguous section', 5),
		];
		const rows = [
			'Repeated section........i',
			'Repeated section........1',
			'Further study........2',
			'Ambiguous section........3',
			'Missing section........4',
		].map(title => ({ title }));
		for (const row of [{ title: 'Further study', locatorKey: '2' }, { title: 'Further study 2' }]) {
			rows[2] = row;
			assert.deepEqual(await getOutline(structuredClone(blocks), [], null, [], {
				pageLabels: ['', 'i', '1', '2', '3', '3'],
				navigationRegions: [{ pageIndex: 0, source: 'heading-concentration', rows }],
			}), [
				{ title: 'Repeated section', ref: [0] },
				{ title: 'Repeated section', ref: [1] },
				{ title: 'Further study', ref: [2] },
			]);
		}
	});

	it('resolves a linked wrapped title even when its first paragraph is excluded', async () => {
		const first = { ...heading('Detailed experimental', 2), type: 'paragraph', flowClass: 'excluded' };
		const second = { ...heading('measurements', 2), type: 'paragraph' };
		assert.deepEqual(await getOutline([first, second], [], null, [], {
			pageLabels: ['-', '-', '1'],
			navigationRegions: [{ pageIndex: 0, source: 'heading-concentration', rows: [{
				title: 'Detailed experimental measurements', locatorKey: '1',
				linkDestinations: [{ pageIndex: 2 }],
			}] }],
		}), [{ title: 'Detailed experimental measurements', ref: [0] }]);
	});

	it('keeps a single authored bookmark even without a detected heading', async () => {
		const position = { pageIndex: 40, rect: [60, 720, 60, 720] };
		assert.deepEqual(await getOutline([], [], null, [{
			title: 'Supplement', location: { position }, items: [],
		}], { pageLabels: Array(100).fill('') }), [{
			title: 'Supplement', source: 'native', target: { position },
		}]);
	});

	it('keeps sparse authored hierarchy and omits broken leaves', async () => {
		const position = { pageIndex: 40 };
		const outline = await getOutline([], [], null, [{
			title: 'Supporting material', items: [
				{ title: 'First study', location: { position }, items: [] },
				{ title: 'Second study', location: { position }, items: [] },
				{ title: 'Broken destination', items: [] },
			],
		}], { pageLabels: Array(100).fill('') });
		assert.deepEqual(outline, [{
			title: 'Supporting material', source: 'native', children: [
				{ title: 'First study', source: 'native', target: { position } },
				{ title: 'Second study', source: 'native', target: { position } },
			],
		}]);
	});

	it('preserves linked contents targets independently of page labels and model exclusions', async () => {
		const blocks = [
			{ ...heading('First study', 2), flowClass: 'excluded' },
			heading('Second study', 1),
		];
		const first = { pageIndex: 2, rect: [60, 720, 60, 720] };
		const second = { pageIndex: 1, rect: [60, 720, 60, 720] };
		assert.deepEqual(await getOutline(blocks, [], null, [], {
			pageLabels: ['', '1', '2'],
			navigationRegions: [{ pageIndex: 0, source: 'heading-concentration', rows: [
				{ title: 'First study........2', linkDestinations: [first] },
				{ title: 'Second study', targetPage: 99, linkDestinations: [second] },
				{ title: 'Ambiguous study', linkDestinations: [first, second] },
			] }],
		}), [
			{ title: 'First study', target: { position: first } },
			{ title: 'Second study', ref: [1] },
		]);
	});
});
