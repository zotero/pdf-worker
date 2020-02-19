const path = require('path');
const exec = require('child_process').exec;

module.exports = {
  watch: true,
  devtool: 'source-map',
  mode: 'development',
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
          exec('node examples/node/index.js', (err, stdout, stderr) => {
            if (stdout) process.stdout.write(stdout);
            if (stderr) process.stderr.write(stderr);
          });
        });
      }
    }
  ]
};
