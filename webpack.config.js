const path = require('path');

module.exports = {
	devtool: 'source-map',
	mode: 'production',
	entry: ['./index.js'],
	output: {
		path: path.join(__dirname, './build'),
		filename: 'pdf-worker.js',
		publicPath: '/',
		libraryTarget: 'umd',
		library: 'pdf-worker',
		globalObject: 'this',
		umdNamedDefine: true
	},
	module: {
		rules: [
			{
				test: /\.(js|jsx)$/,
				exclude: /node_modules/
			}
		]
	},
	resolve: {
		extensions: ['*', '.js']
	}
};
