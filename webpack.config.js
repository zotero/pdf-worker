const path = require('path');
const webpack = require('webpack');

module.exports = {
	entry: ['./src/index.js'],
	output: {
		path: path.join(__dirname, './build'),
		filename: 'worker.js',
		publicPath: '/',
		globalObject: 'this',
		library: {
			name: 'worker',
			type: 'umd',
			umdNamedDefine: true,
		},
	},
	optimization: {
		minimize: false
	},
	module: {
		rules: [
			{
				test: /\.(js|jsx)$/,
				exclude: /node_modules/
			}
		]
	},
	plugins: [
		// Ignore objects that only exist on browser and break webpack building process
		new webpack.IgnorePlugin({ resourceRegExp: /^(canvas|fs|https|url|http)$/u })
	],
	resolve: {
		extensions: ['*', '.js']
	}
};
