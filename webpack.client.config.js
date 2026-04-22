const path = require('path');
const CopyPlugin = require('copy-webpack-plugin');

module.exports = {
  target: 'web',
  mode: 'production',
  entry: './src/client/app.ts',
  output: {
    path: path.resolve(__dirname, 'dist/public/js'),
    filename: 'app.js'
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: {
          loader: 'ts-loader',
          options: {
            configFile: path.resolve(__dirname, 'tsconfig.client.json')
          }
        }
      }
    ]
  },
  resolve: {
    extensions: ['.ts', '.js', '.json']
  },
  plugins: [
    // Copy static files
    new CopyPlugin({
      patterns: [
        { from: 'public/css', to: path.resolve(__dirname, 'dist/public/css') },
        { from: 'src/server/views', to: path.resolve(__dirname, 'dist/views') }
      ]
    })
  ],
  optimization: {
    minimize: true
  },
  performance: {
    hints: false
  }
};