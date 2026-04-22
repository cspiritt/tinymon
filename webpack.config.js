const path = require('path');
const nodeExternals = require('webpack-node-externals');
const CopyPlugin = require('copy-webpack-plugin');

module.exports = {
  target: 'node',
  mode: 'production',
  entry: './src/server/index.ts',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'bundle.js',
    libraryTarget: 'commonjs2'
  },
  node: {
    __dirname: false,
    __filename: false
  },
  externals: [
    // Exclude only database drivers as they are native or external
    // Other modules will be included in the bundle
    'better-sqlite3',
    'pg',
    'mysql2',
    'pg-native',
    'mysql',
    'node-telegram-bot-api'
  ],
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: [/node_modules/, /src\/client/],
        use: {
          loader: 'ts-loader'
        }
      }
    ]
  },
  plugins: [
    new CopyPlugin({
      patterns: [
        { from: 'settings.json', to: 'settings.json' },
        { from: 'settings.d', to: 'settings.d', toType: 'dir' },
        { from: 'src/server/views', to: 'views', toType: 'dir' },
        { from: 'public/css', to: 'public/css', toType: 'dir' },
        { from: 'README.md', to: 'README.md' },
        {
          from: 'package.json',
          to: 'package.json',
          transform(content) {
            const packageJson = JSON.parse(content.toString());
            // Keep only essential fields
            return JSON.stringify({
              name: packageJson.name,
              version: packageJson.version,
              description: packageJson.description,
              main: 'bundle.js',
              scripts: {
                start: 'node bundle.js'
              },
              dependencies: {},
              peerDependencies: {
                'better-sqlite3': '*',
                'pg': '*',
                'mysql2': '*'
              },
              engines: packageJson.engines
            }, null, 2);
          }
        }
      ]
    })
  ],
  resolve: {
    extensions: ['.ts', '.js', '.json']
  },
  optimization: {
    minimize: true,
    minimizer: []
  },
  performance: {
    hints: false
  }
};