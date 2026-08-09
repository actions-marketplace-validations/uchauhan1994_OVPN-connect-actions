const fs = require('node:fs')
const path = require('node:path')
const {spawnSync} = require('node:child_process')
const ping = require('ping')

let core

const credentialFiles = {
  CA_CRT: 'ca.crt',
  USER_CRT: 'user.crt',
  USER_KEY: 'user.key',
}

function readEnvironment(name, required = false) {
  const value = (process.env[name] || '').trim()

  if (required && !value) {
    throw new Error(`Environment variable ${name} is required`)
  }

  if (value) {
    core.setSecret(value)
  }

  return value
}

function readInputOrEnvironment(inputName, environmentName) {
  const input = core.getInput(inputName).trim()
  const value = input || readEnvironment(environmentName)

  if (value) {
    core.setSecret(value)
  }

  return value
}

function decodeCredential(value, name) {
  const encoded = value.replace(/\s/g, '')
  const isBase64 =
    encoded.length > 0 &&
    encoded.length % 4 === 0 &&
    /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      encoded,
    )

  if (!isBase64) {
    throw new Error(`${name} must contain valid Base64 data`)
  }

  return Buffer.from(encoded, 'base64')
}

function writeCredential(filename, value, name) {
  const destination = path.resolve(process.cwd(), filename)

  if (
    fs.existsSync(destination) &&
    fs.lstatSync(destination).isSymbolicLink()
  ) {
    throw new Error(`Refusing to overwrite symbolic link: ${filename}`)
  }

  fs.writeFileSync(destination, decodeCredential(value, name), {
    flag: 'w',
    mode: 0o600,
  })
  fs.chmodSync(destination, 0o600)
}

function resolveConfiguration(filename) {
  const resolved = path.resolve(process.cwd(), filename)

  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    throw new Error(`OpenVPN configuration not found: ${filename}`)
  }

  return resolved
}

function startOpenVpn(configuration) {
  const result = spawnSync(
    'sudo',
    ['openvpn', '--config', configuration, '--daemon'],
    {stdio: 'inherit'},
  )

  if (result.error) {
    throw result.error
  }

  if (result.status !== 0) {
    throw new Error(`OpenVPN exited with status ${result.status}`)
  }
}

function validatePingTarget(target) {
  if (!target || target.startsWith('-') || /\s/.test(target)) {
    throw new Error(`Invalid ping target: ${target}`)
  }

  return target
}

async function run() {
  core = await import(/* webpackMode: 'eager' */ '@actions/core')

  const configuration = resolveConfiguration(
    core.getInput('FILE_OVPN').trim() || './config.ovpn',
  )
  const pingTarget = validatePingTarget(
    core.getInput('PING_URL').trim() || '127.0.0.1',
  )
  const usernamePassword = readInputOrEnvironment(
    'SECRET',
    'SECRET_USERNAME_PASSWORD',
  )
  const tlsKey = readInputOrEnvironment('TLS_KEY', 'TLS_KEY')

  for (const [name, filename] of Object.entries(credentialFiles)) {
    writeCredential(filename, readEnvironment(name, true), name)
  }

  if (usernamePassword) {
    writeCredential('secret.txt', usernamePassword, 'SECRET')
  }

  if (tlsKey) {
    writeCredential('tls.key', tlsKey, 'TLS_KEY')
  }

  startOpenVpn(configuration)

  const response = await ping.promise.probe(pingTarget, {
    timeout: 15,
    min_reply: 15,
  })

  core.setOutput('STATUS', response.alive)

  if (!response.alive) {
    throw new Error(`VPN verification failed for ${pingTarget}`)
  }

  core.info(`VPN connection verified through ${pingTarget}`)
}

run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error)

  if (core) {
    core.setOutput('STATUS', false)
    core.setFailed(message)
  } else {
    console.error(message)
    process.exitCode = 1
  }
})
