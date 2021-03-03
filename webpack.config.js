const path = require('path');
const exec = require('child_process').exec;

module.exports = {
	watch: process.env.NODE_ENV !== 'production',
	devtool: false,
	mode: process.env.NODE_ENV === 'production' ? 'production' : 'development',
	entry: ['./src/index.js'],
	output: {
		path: path.join(__dirname, './build'),
		filename: 'pdf-worker.js',
		publicPath: '/',
		libraryTarget: 'umd',
		library: 'pdf-worker',
		globalObject: 'this',
		umdNamedDefine: true
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
	},
	plugins: [
		{
			apply: (compiler) => {
				compiler.hooks.afterEmit.tap('AfterEmitPlugin', (compilation) => {
					if (process.env.NODE_ENV !== 'production') {
						exec('node examples/node/index.js', (err, stdout, stderr) => {
							if (stdout) process.stdout.write(stdout);
							if (stderr) process.stderr.write(stderr);
						});
					}
				});
			}
		}
	]
};
