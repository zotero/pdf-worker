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
    let buf = fs.readFileSync(__dirname + '/test.pdf');
    let annotations = await pdfWorker.readAnnotations(buf);
    console.log(annotations);
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
    
    let buf = fs.readFileSync(__dirname + '/test.pdf');
    buf = await pdfWorker.writeAnnotations(buf, annotations);
    var buffer = Buffer.from(buf);
    let md5 = crypto.createHash('md5').update(buffer).digest('hex');
    console.log(md5);
  });
});
