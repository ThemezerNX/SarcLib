# SarcLib

A library for packing and unpacking SARC/SZS archives, with Yaz0 compression support.

Heavily based on

- [SarcLib](https://github.com/aboood40091/SarcLib) by RoadrunnerWMC, MasterVermilli0n/AboodXD
- [sarc](https://github.com/zeldamods/sarc) by leoetlino

# Installation

```bash
yarn add @themezernx/sarclib

npm install @themezernx/sarclib
```

```ts
// ES5/ES6
import {SarcFile} from "@themezernx/sarclib/dist";

// commonjs
const {SarcFile} = require("@themezernx/sarclib/dist");
```

# Docs

Read the docs [here](http://themezernx.github.io/SarcLib)

# Build

```bash
# install dependencies
yarn

# compile
yarn run build

# simple test
yarn run test
```
