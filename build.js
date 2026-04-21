const fs = require('fs-extra');
const path = require('path');

const sourceDir = __dirname;
const targetDir = path.join(__dirname, 'dist');

// Файлы и папки, которые нужно скопировать
const copyItems = [
  'index.js',
  'package.json',
  'package-lock.json',
  'settings.json',
  'README.md',
  'models',
  'routes',
  'utils',
  'views',
  'public',
  'settings.d'
];

// Файлы и папки, которые нужно игнорировать
const ignorePatterns = [
  'node_modules',
  '.git',
  'dist',
  '.DS_Store',
  '*.log',
  '*.db',
  '*.db-journal'
];

async function cleanTarget() {
  console.log('Очистка целевой директории...');
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
      
      // Проверяем, нужно ли игнорировать этот элемент
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
    console.log(`Скопирован: ${path.relative(sourceDir, source)}`);
  }
}

async function updatePackageJson() {
  const packagePath = path.join(targetDir, 'package.json');
  const packageJson = await fs.readJson(packagePath);
  
  // Удаляем devDependencies, так как они не нужны в продакшене
  delete packageJson.devDependencies;
  
  // Удаляем скрипты, которые не нужны в продакшене
  delete packageJson.scripts.dev;
  delete packageJson.scripts.build;
  delete packageJson.scripts.clean;
  
  // Добавляем скрипт для запуска из dist
  packageJson.scripts = {
    start: 'node index.js'
  };
  
  await fs.writeJson(packagePath, packageJson, { spaces: 2 });
  console.log('Обновлен package.json для продакшена');
}

async function createGitignore() {
  const gitignoreContent = `# Игнорируемые файлы в продакшене
node_modules/
*.log
*.db
*.db-journal
.DS_Store
`;
  await fs.writeFile(path.join(targetDir, '.gitignore'), gitignoreContent);
  console.log('Создан .gitignore');
}

async function build() {
  try {
    console.log('Начало сборки проекта...');
    
    // Очищаем целевую директорию
    await cleanTarget();
    
    // Копируем файлы и папки
    for (const item of copyItems) {
      const source = path.join(sourceDir, item);
      const target = path.join(targetDir, item);
      
      if (await fs.pathExists(source)) {
        await copyFileOrDir(source, target);
      } else {
        console.warn(`Предупреждение: ${item} не найден`);
      }
    }
    
    // Обновляем package.json для продакшена
    await updatePackageJson();
    
    // Создаем .gitignore
    await createGitignore();
    
    console.log('✅ Сборка завершена успешно!');
    console.log(`📁 Итоговая сборка находится в: ${targetDir}`);
    console.log('\nДля запуска приложения из dist:');
    console.log(`  cd ${targetDir}`);
    console.log('  npm install --production');
    console.log('  npm start');
    
  } catch (error) {
    console.error('❌ Ошибка при сборке:', error);
    process.exit(1);
  }
}

// Запускаем сборку
build();