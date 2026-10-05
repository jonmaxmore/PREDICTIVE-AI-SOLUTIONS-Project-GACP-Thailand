#!/usr/bin/env node
/**
 * Selftest for shared/notification-view.js — zero dependencies.
 *
 * WHY THIS EXISTS ALONGSIDE THE JEST TEST: the jest suite needs `pnpm install`, and the
 * quickest place to verify this change is a fresh clone on the staging box where nothing
 * is installed. `npx jest` there tries to fetch jest over the network and hangs. This
 * runner uses only `node:assert`, so it works on any machine that has node at all.
 *
 * The jest test at __tests__/unit/notification-view.test.js covers the same cases and is
 * the one CI runs. This file is for verifying the change by hand, today.
 *
 * Run:  node apps/backend/shared/notification-view.selftest.js
 * Exit: 0 = pass, 1 = fail
 */
'use strict';

const assert = require('node:assert');

let pass = 0;
const failures = [];

function check(name, fn) {
    try {
        fn();
        pass += 1;
        console.log(`  PASS  ${name}`);
    } catch (err) {
        failures.push({ name, message: err.message });
        console.log(`  FAIL  ${name}`);
        console.log(`        ${err.message}`);
    }
}

console.log('=== notification-view selftest ===');

let toNotificationView;
try {
    ({ toNotificationView } = require('./notification-view'));
} catch (err) {
    console.log('  FAIL  โหลดโมดูล shared/notification-view ได้');
    console.log(`        ${err.message}`);
    console.log('');
    console.log('=== ผล: PASS=0 FAIL=1 (โมดูลยังไม่มี — นี่คือ RED ที่ถูกต้อง) ===');
    process.exit(1);
}

check('ยก actionUrl ที่อยู่ใน metadata ขึ้นมาระดับบนสุด', () => {
    const row = { id: 'n1', title: 'เอกสารต้องแก้ไข', metadata: { actionUrl: '/health/applications/a1/revision' } };
    assert.strictEqual(toNotificationView(row).actionUrl, '/health/applications/a1/revision');
});

check('คงฟิลด์เดิมไว้ครบ', () => {
    const row = { id: 'n1', title: 'x', message: 'y', isRead: false, metadata: { actionUrl: '/a' } };
    const out = toNotificationView(row);
    assert.strictEqual(out.id, 'n1');
    assert.strictEqual(out.title, 'x');
    assert.strictEqual(out.message, 'y');
    assert.strictEqual(out.isRead, false);
});

check('metadata ไม่มี actionUrl → undefined ไม่พัง', () => {
    assert.strictEqual(toNotificationView({ id: 'n1', metadata: { applicationId: 'a1' } }).actionUrl, undefined);
});

check('metadata เป็น null → ไม่พัง', () => {
    assert.strictEqual(toNotificationView({ id: 'n1', metadata: null }).actionUrl, undefined);
});

check('ไม่มีฟิลด์ metadata เลย → ไม่พัง', () => {
    assert.strictEqual(toNotificationView({ id: 'n1' }).actionUrl, undefined);
});

check('metadata เป็นสตริง (แถวเก่ารูปไม่ตรง) → ไม่พัง', () => {
    assert.strictEqual(toNotificationView({ id: 'n1', metadata: 'legacy' }).actionUrl, undefined);
});

check('actionUrl ที่ไม่ใช่สตริงถูกปฏิเสธ', () => {
    assert.strictEqual(toNotificationView({ id: 'n1', metadata: { actionUrl: 42 } }).actionUrl, undefined);
    assert.strictEqual(toNotificationView({ id: 'n1', metadata: { actionUrl: {} } }).actionUrl, undefined);
});

check('รับ null/undefined แล้วไม่พัง', () => {
    assert.doesNotThrow(() => toNotificationView(null));
    assert.doesNotThrow(() => toNotificationView(undefined));
});

check('ไม่แก้ไขแถวต้นฉบับ', () => {
    const row = { id: 'n1', metadata: { actionUrl: '/a' } };
    toNotificationView(row);
    assert.strictEqual(row.actionUrl, undefined);
});

console.log('');
console.log(`=== ผล: PASS=${pass} FAIL=${failures.length} ===`);
process.exit(failures.length === 0 ? 0 : 1);
