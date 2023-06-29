const path = require('path');

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
	resolve: {
		extensions: ['*', '.js']
	}
};
