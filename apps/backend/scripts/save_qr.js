const fs = require('fs');
const path = require('path');

const outputDir = path.join(__dirname, '..', 'e2e-output');

// Ensure output directory exists
if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
}

// Latest QR Code data from golden scenario
const qrData = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAZAAAAGQCAYAAACAvzbMAAAAAklEQVR4AewaftIAAArMSURBVO3BgW0k2q4ksJIw+adc+0I4K7jR374kp/8TAPj/tAGAgw0AHGwA4GADAAcbADjYAMDBBgAONgBwsAGAgw0AHGwA4GADAAcbADjYAMDBBgAONgBwsAGAgw0AHGwA4GADAAcbADj4lw+ZmfCubV7NTH5a23zCzOSntc2rmckntM2rmclPa5tvm5m8apufNjPhXdv8tA0AHGwA4GADAAcbADjYAMDBBgAONgBwsAGAgw0AHGwA4OBf/g9om79oZvIJbfNiZvIJM5NXbfNqZvJiZvKqbX6TtnkxM3nVNp/QNq9mJi/a5hPa5i+amXzTBgAONgBwsAGAgw0AHGwA4GADAAcbADjYAMDBBgAONgBw8C+/zMzkm9qGz2ibb5qZfELbfNPM5Nva5reYmXxT2/wWGwA42ADAwQYADjYAcLABgIMNABxsAOBgAwAHGwA42ADAwb/w68xMftrMhHdt82pm8qptflrbfMLM5NXM5EXb8HtsAOBgAwAHGwA42ADAwQYADjYAcLABgIMNABxsAODgX+CDZibf1Dav2ua3aJtPmJl8Qtvw92wA4GADAAcbADjYAMDBBgAONgBwsAGAgw0AHGwA4GADAAf/8su0DW/a5hNmJp/QNi9mJq9mJq/a5tXM5BNmJr9F27yambxom29rG95sAOBgAwAHGwA42ADAwQYADjYAcLABgIMNABxsAOBgAwAH//J/wMyE75qZvGqbVzOTb2qbVzOTV23zambyqm1ezExetc2rmclfNDPh520A4GADAAcbADjYAMDBBgAONgBwsAGAgw0AHGwA4GADAAf/8iFtA5/QNq9mJt/WNt80M/m2tvlpbcN3bQDgYAMABxsAONgAwMEGAA42AHCwAYCDDQAcbADgYAMAB//yITOTV23zTTOTV23zambyambyW8xMfouZyau2+YSZyYu2+baZyU9rm2+bmbxqmxczk79oAwAHGwA42ADAwQYADjYAcLABgIMNABxsAOBgAwAHGwA4+JcPaZtPmJm8aptXbfMJbfNqZvLTZiav2ua3mJn8VW3zom3+orb5hJnJN81MXrXNb7EBgIMNABxsAOBgAwAHGwA42ADAwQYADjYAcLABgIMNABz8y4fMTD6hbV7N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';

const lotNumber = 'LOT-2569-700003-A';

// Save QR code image
const base64Data = qrData.replace(/^data:image\/png;base64,/, '');
const buffer = Buffer.from(base64Data, 'base64');

const filepath = path.join(outputDir, `qr-code-${lotNumber}.png`);
fs.writeFileSync(filepath, buffer);
console.log('QR Code saved:', filepath);

// Save label data
const labelData = {
    lotNumber: 'LOT-2569-700003-A',
    batchNumber: 'BATCH-2569-700003',
    plant: 'Cannabis (กัญชา)',
    farmName: 'UAT Test Farm',
    province: 'Bangkok',
    packageType: 'vacuum_sealed',
    weight: '1 kg',
    thcContent: '15.5%',
    cbdContent: '0.3%',
    harvestDate: '2026-01-25',
    packagedAt: '2026-01-25',
    expiryDate: '2027-01-25',
    // Resolved the same way the real label pipeline does
    // (services/pdf/lot-label-template-service.js:45). This used to hardcode
    // https://203.0.113.20/... — a raw IP baked into a tracking URL. QR codes
    // are printed onto physical lots and outlive any host, so the DigitalOcean
    // droplet's decommissioning would have dead-ended every label already in
    // circulation. Always a hostname, never an IP.
    trackingUrl: `${process.env.PUBLIC_TRACE_URL || process.env.TRACE_BASE_URL || 'https://gacpth.com/trace'}/8d7593ed-794f-4b01-8898-6e685c3d4884`,
    qrCodeId: '8d7593ed-794f-4b01-8898-6e685c3d4884',
};

const labelPath = path.join(outputDir, `qr-label-${lotNumber}.json`);
fs.writeFileSync(labelPath, JSON.stringify(labelData, null, 2));
console.log('Label data saved:', labelPath);

// List files
const files = fs.readdirSync(outputDir);
console.log('\n Files in e2e-output:');
files.forEach(f => console.log('   -', f));
