const colorDiff = require('color-diff');

let colors = [
  ['Red', '#ff6666'],
  ['Orange', '#ff8c19'],
  ['Green', '#5fb236'],
  ['Blue', '#2ea8e5'],
  ['Purple', '#a28ae5']
];

function hexToRgb(hex) {
  var result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (result) {
    return [
      parseInt(result[1], 16),
      parseInt(result[2], 16),
      parseInt(result[3], 16)
    ]
  }
  return [0, 0, 0];
}

function arrayColorToHex(color) {
  if (!color || color.length !== 3) return '';

  let result = '#';
  for (let c of color) {
    let hex = c.toString(16);
    result += hex.length === 1 ? '0' + hex : hex;
  }

  return result;
}

function getClosestColor(color) {
  let [R, G, B] = hexToRgb(color);
  color = { R, G, B };
  let palette = colors.map(color => {
    let [R, G, B] = hexToRgb(color[1]);
    return { R, G, B }
  });
  let res = colorDiff.closest(color, palette);
  let hex = arrayColorToHex([res.R, res.G, res.B]);
  return colors[colors.findIndex(color => color[1] === hex)][1];
}

exports.getClosestColor = getClosestColor;
exports.arrayColorToHex = arrayColorToHex;
