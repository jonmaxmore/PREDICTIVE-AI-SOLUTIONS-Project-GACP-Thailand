const express = require('express');

const router = express.Router();

function redirectToApiTrace(req, res, pathSuffix) {
  const normalized = String(pathSuffix || '').replace(/^\/+/, '');
  return res.redirect(302, `/api/trace/${normalized}`);
}

router.get('/plot-cycle/:qrCode', (req, res) => redirectToApiTrace(
  req,
  res,
  `plot-cycle/${encodeURIComponent(req.params.qrCode)}`,
));

router.get('/batch/:batchId', (req, res) => redirectToApiTrace(
  req,
  res,
  `batch/${encodeURIComponent(req.params.batchId)}`,
));

router.get('/lot/:lotId', (req, res) => redirectToApiTrace(
  req,
  res,
  `lot/${encodeURIComponent(req.params.lotId)}`,
));

router.get('/verify/:entityType/:entityId', (req, res) => redirectToApiTrace(
  req,
  res,
  `verify/${encodeURIComponent(req.params.entityType)}/${encodeURIComponent(req.params.entityId)}`,
));

router.get('/:qrCode/qr', (req, res) => redirectToApiTrace(
  req,
  res,
  `${encodeURIComponent(req.params.qrCode)}/qr`,
));

router.get('/:qrCode', (req, res) => redirectToApiTrace(
  req,
  res,
  encodeURIComponent(req.params.qrCode),
));

module.exports = router;
