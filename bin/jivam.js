#!/usr/bin/env node
'use strict'

const path = require('path')
const serverEntry = path.join(__dirname, '..', 'dist-server', 'index.js')

require(serverEntry)
