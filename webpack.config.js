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
				exclude: /node_modules/,
				use: {
					loader: "babel-loader",
					options: {
						presets: [['@babel/preset-env', { useBuiltIns: "usage", corejs: { version: "3.37" } }]],
						plugins: ["@babel/plugin-transform-modules-commonjs"]
					}
				}
			}
		]
	},
	resolve: {
		extensions: ['*', '.js']
	}
};
