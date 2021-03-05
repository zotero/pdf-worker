/*
 ***** BEGIN LICENSE BLOCK *****

 This file is part of the Zotero Data Server.

 Copyright © 2020 Center for History and New Media
 George Mason University, Fairfax, Virginia, USA
 http://zotero.org

 This program is free software: you can redistribute it and/or modify
 it under the terms of the GNU Affero General Public License as published by
 the Free Software Foundation, either version 3 of the License, or
 (at your option) any later version.

 This program is distributed in the hope that it will be useful,
 but WITHOUT ANY WARRANTY; without even the implied warranty of
 MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 GNU Affero General Public License for more details.

 You should have received a copy of the GNU Affero General Public License
 along with this program.  If not, see <http://www.gnu.org/licenses/>.

 ***** END LICENSE BLOCK *****
 */

const expect = require('chai').expect;

const fs = require('fs');
const crypto = require('crypto');

const pdfWorker = require('../src');

describe('PDF Worker', function () {
	it('should extract annotations', async function () {
		let buf = fs.readFileSync(__dirname + '/pdfs/1.pdf');
		let annotations = await pdfWorker.readAnnotations(buf, []);
		// console.log(annotations);
	});

	it('should write annotations', async function () {
		let annotations = [{
			'type': 'highlight',
			'color': '#589fee',
			'position': {
				'pageIndex': 0,
				'rects': [
					[231.284, 402.126, 293.107, 410.142],
					[54, 392.164, 293.107, 400.18],
					[54, 382.201, 293.107, 390.217],
					[54, 372.238, 293.107, 380.254],
					[54, 362.276, 273.955, 370.292]
				]
			},
			'authorName': '',
			'text': 'We present an alternative compilation technique for dynamically-typed languages that identifies frequently executed loop traces at run-time and then generates machine code on the fly that is specialized for the actual dynamic types occurring on each path through the loop',
			'comment': 'Sounds promising',
			'tags': [],
			'id': 91115751444169,
			'dateModified': '2020-02-07T07:24:34.638Z',
			'dateCreated': '2020-02-03T11:07:16.181Z',
			'userId': 123,
			'label': 'john',
			'page': 1,
			'sortIndex': '000000|0000779|000381.858'
		}];

		let buf = fs.readFileSync(__dirname + '/pdfs/1.pdf');
		buf = await pdfWorker.writeAnnotations(buf, annotations);
		var buffer = Buffer.from(buf);
		let md5 = crypto.createHash('md5').update(buffer).digest('hex');
		// console.log(md5);
	});

	it('should import Mendeley annotations', async function () {
		let buf = fs.readFileSync(__dirname + '/pdfs/2.pdf');
		let mendeleyAnnotations = [
			{
				id: 1,
				type: 'note',
				page: 2,
				x: 446.040241448692,
				y: 657.971830985916
			},
			{
				type: 'highlight',
				page: 2,
				rects: [
					{
						x1: 166.2053,
						y1: 375.23994140625,
						x2: 503.8281,
						y2: 384.41279296875
					},
					{
						x1: 108.1,
						y1: 363.62021484375,
						x2: 503.5352,
						y2: 372.81279296875
					},
					{
						x1: 108.1,
						y1: 352.418310546875,
						x2: 503.953758203125,
						y2: 361.11279296875
					}
				]
			},
			{
				type: 'highlight',
				page: 2,
				rects: [
					{
						x1: 171.995975855131,
						y1: 641.070422535211,
						x2: 443.625754527163,
						y2: 475.074446680081
					}
				]
			},
			{
				type: 'highlight',
				page: 2,
				rects: [
					{
						x1: 166.2053,
						y1: 375.23994140625,
						x2: 503.8281,
						y2: 384.41279296875
					}
				]
			}
		];
		let annotations = await pdfWorker.importMendeleyAnnotations(buf, mendeleyAnnotations);

		let result = [{
			id: 1,
			position: {
				pageIndex: 1,
				rects: [[435.04, 646.972, 457.04, 668.972]]
			}, type: 'note', pageLabel: '2', sortIndex: '00001|000195|00123'
		}, {
			position: {
				pageIndex: 1,
				rects: [[166.205, 375.24, 503.828, 384.413], [108.1, 363.62, 503.535, 372.813], [108.1, 352.418, 503.954, 361.113]]
			},
			type: 'highlight',
			pageLabel: '2',
			text: 'For our purposes, the earliest transaction is the one that counts, so we don\'t care about later attempts to double-spend. The only way to confirm the absence of a transaction is to be aware of all transactions. In the mint based model, the mint was aware of all transactions and ',
			sortIndex: '00001|000817|00407'
		}, {
			position: { pageIndex: 1, rects: [[171.996, 475.074, 443.626, 641.07]] },
			type: 'image',
			pageLabel: '2',
			sortIndex: '00001|002145|00150'
		}, {
			position: { pageIndex: 1, rects: [[166.205, 375.24, 503.828, 384.413]] },
			type: 'highlight',
			pageLabel: '2',
			text: 'For our purposes, the earliest transaction is the one that counts, so we don\'t care ',
			sortIndex: '00001|000817|00407'
		}];

		expect(annotations).to.deep.equal(result);
	});
});
