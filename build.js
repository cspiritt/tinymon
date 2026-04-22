const fs = require('fs-extra');
const path = require('path');

const sourceDir = __dirname;
const targetDir = path.join(__dirname, 'dist');

// Check for --no-clean flag
const skipClean = process.argv.includes('--no-clean');

// Files and folders to copy
const copyItems = [
  'index.js',
  'package.json',
  'package-lock.json',
  'settings.json',
  'README.md',
  'models',
  'routes',
  'utils',
  'src/server/views',
  'public',
  'settings.d'
];

// Files and folders to ignore
const ignorePatterns = [
  'node_modules',
  '.git',
  'dist',
  '.DS_Store',
  '*.log',
  '*.db',
  '*.db-journal',
  'js'  // Ignore empty js directory in public
];

async function cleanTarget() {
  console.log('Cleaning target directory...');
  await fs.remove(targetDir);
  await fs.ensureDir(targetDir);
}

async function copyFileOrDir(source, target) {
  const stat = await fs.stat(source);
  
  if (stat.isDirectory()) {
    await fs.ensureDir(target);
    const items = await fs.readdir(source);
    
    for (const item of items) {
      const itemPath = path.join(source, item);
      const targetPath = path.join(target, item);
      
      // Check if this item should be ignored
      const shouldIgnore = ignorePatterns.some(pattern => {
        if (pattern.includes('*')) {
          const regex = new RegExp(pattern.replace('*', '.*'));
          return regex.test(item);
        }
        return item === pattern;
      });
      
      if (!shouldIgnore) {
        await copyFileOrDir(itemPath, targetPath);
      }
    }
  } else {
    await fs.copy(source, target);
    console.log(`Copied: ${path.relative(sourceDir, source)}`);
  }
}

async function updatePackageJson() {
  const packagePath = path.join(targetDir, 'package.json');
  const packageJson = await fs.readJson(packagePath);
  
  // Remove devDependencies as they're not needed in production
  delete packageJson.devDependencies;
  
  // Remove scripts that are not needed in production
  delete packageJson.scripts.dev;
  delete packageJson.scripts.build;
  delete packageJson.scripts.clean;
  
  // Add script for running from dist
  packageJson.scripts = {
    start: 'node index.js'
  };
  
  await fs.writeJson(packagePath, packageJson, { spaces: 2 });
  console.log('Updated package.json for production');
}

async function createGitignore() {
  const gitignoreContent = `# Files to ignore in production
node_modules/
*.log
*.db
*.db-journal
.DS_Store
`;
  await fs.writeFile(path.join(targetDir, '.gitignore'), gitignoreContent);
  console.log('Created .gitignore');
}

async function build() {
  try {
    console.log('Starting project build...');

    // Clean target directory unless --no-clean flag is set
    if (!skipClean) {
      await cleanTarget();
    } else {
      console.log('Skipping clean target directory (--no-clean flag set)');
    }
    
    // Copy files and folders
    for (const item of copyItems) {
      let source = path.join(sourceDir, item);
      let target = path.join(targetDir, item);
      
      // Special handling for views which are now in src/server/views
      if (item === 'src/server/views') {
        target = path.join(targetDir, 'views');
      }

      if (await fs.pathExists(source)) {
        await copyFileOrDir(source, target);
      } else {
        console.warn(`Warning: ${item} not found`);
      }
    }
    
    // Update package.json for production
    await updatePackageJson();
    
    // Create .gitignore
    await createGitignore();
    
    console.log('✅ Build completed successfully!');
    console.log(`📁 Final build location: ${targetDir}`);
    console.log('\nTo run the application from dist:');
    console.log(`  cd ${targetDir}`);
    console.log('  npm install --production');
    console.log('  npm start');
    
  } catch (error) {
    console.error('❌ Build error:', error);
    process.exit(1);
  }
}

// Start the build
build();