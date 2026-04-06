/**
 * tests/setup.js — Vitest global setup
 *
 * Provides test isolation: each test gets a clean temp state directory.
 */
'use strict'

const fs   = require('fs')
const path = require('path')
const os   = require('os')

// Ensure test environment
process.env.NODE_ENV = 'test'
