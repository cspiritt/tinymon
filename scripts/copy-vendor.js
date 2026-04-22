const fs = require('fs-extra');
const path = require('path');

const projectRoot = __dirname + '/..';
const vendorDir = path.join(projectRoot, 'public', 'vendor');

async function copyVendorAssets() {
  console.log('Copying vendor assets to public/vendor...');

  // Ensure vendor directory exists
  await fs.ensureDir(vendorDir);

  // Copy Font Awesome
  const faSource = path.join(projectRoot, 'node_modules', '@fortawesome', 'fontawesome-free');
  const faTarget = path.join(vendorDir, 'fontawesome');

  console.log(`Copying Font Awesome from ${faSource} to ${faTarget}`);

  // Ensure target directories exist
  await fs.ensureDir(path.join(faTarget, 'css'));
  
  // Copy CSS
  await fs.copy(
    path.join(faSource, 'css', 'all.min.css'),
    path.join(faTarget, 'css', 'all.min.css')
  );

  // Copy webfonts directory
  await fs.copy(
    path.join(faSource, 'webfonts'),
    path.join(faTarget, 'webfonts')
  );

  // Copy Inter font
  const interSource = path.join(projectRoot, 'node_modules', 'typeface-inter', 'Inter Web');
  const interTarget = path.join(vendorDir, 'inter');

  console.log(`Copying Inter font from ${interSource} to ${interTarget}`);

  // Copy entire Inter Web directory
  await fs.copy(interSource, interTarget);

  console.log('Vendor assets copied successfully!');
}

// Run if called directly
if (require.main === module) {
  copyVendorAssets().catch(err => {
    console.error('Error copying vendor assets:', err);
    process.exit(1);
  });
}

module.exports = copyVendorAssets;