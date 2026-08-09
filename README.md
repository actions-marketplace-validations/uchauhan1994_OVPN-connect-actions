# OVPN Connect Action

Connect a GitHub Actions job to an OpenVPN network and confirm that a host is
reachable through the tunnel.

The action decodes VPN credentials from GitHub Secrets, starts OpenVPN in the
background, and exposes a status output after testing the configured address. It
runs on Node.js 24.

## Requirements

- A Linux GitHub Actions runner
- OpenVPN installed on the runner
- An `.ovpn` client configuration stored in the repository
- The required certificates and private key stored as GitHub Secrets

## Inputs

| Input       | Description                                      | Required | Default         |
| ----------- | ------------------------------------------------ | -------- | --------------- |
| `FILE_OVPN` | Path to the OpenVPN client configuration         | Yes      | `./config.ovpn` |
| `PING_URL`  | Host or IP address used to verify the connection | Yes      | `127.0.0.1`     |
| `SECRET`    | Base64-encoded username/password file            | No       | Empty           |
| `TLS_KEY`   | Base64-encoded TLS crypt key                     | No       | Empty           |

## Required environment variables

| Variable   | Description                                      |
| ---------- | ------------------------------------------------ |
| `CA_CRT`   | Base64-encoded certificate-authority certificate |
| `USER_CRT` | Base64-encoded client certificate                |
| `USER_KEY` | Base64-encoded client private key                |

When inputs `SECRET` or `TLS_KEY` are not provided, the action can read their
values from `SECRET_USERNAME_PASSWORD` and `TLS_KEY` environment variables.

## Output

| Output   | Description                                                   |
| -------- | ------------------------------------------------------------- |
| `STATUS` | `true` when the verification host responds; otherwise `false` |

## Example workflow

```yaml
name: VPN connection test

on:
  workflow_dispatch:

permissions:
  contents: read

jobs:
  connect-vpn:
    runs-on: ubuntu-latest

    steps:
      - name: Check out repository
        uses: actions/checkout@v6

      - name: Install OpenVPN
        run: |
          sudo apt-get update
          sudo apt-get install --yes openvpn

      - name: Connect to VPN
        id: vpn
        uses: uchauhan1994/OVPN-connect-actions@main
        with:
          FILE_OVPN: .github/vpn/config.ovpn
          PING_URL: 10.0.0.10
          SECRET: ${{ secrets.SECRET_USERNAME_PASSWORD }}
          TLS_KEY: ${{ secrets.TLS_KEY }}
        env:
          CA_CRT: ${{ secrets.CA_CRT }}
          USER_CRT: ${{ secrets.USER_CRT }}
          USER_KEY: ${{ secrets.USER_KEY }}

      - name: Display connection status
        run: echo "VPN connected: ${{ steps.vpn.outputs.STATUS }}"

      - name: Disconnect and remove credentials
        if: always()
        run: |
          sudo pkill openvpn || true
          rm -f ca.crt user.crt user.key tls.key secret.txt
```

For production workflows, reference a released version or full commit SHA
instead of the moving `main` branch.

## Prepare the OpenVPN configuration

Remove embedded credentials from the `.ovpn` file and reference the files that
the action creates:

```text
ca ca.crt
cert user.crt
key user.key
```

If the VPN requires username/password authentication or a TLS crypt key, add:

```text
auth-user-pass secret.txt
tls-crypt tls.key
```

Only keep the lines required by your VPN provider.

## Create the secrets

Encode each credential locally. Do not paste private keys or passwords into an
online encoding service. Base64 is an encoding format, not encryption.

Linux:

```bash
base64 -w 0 ca.crt
base64 -w 0 user.crt
base64 -w 0 user.key
base64 -w 0 tls.key
base64 -w 0 secret.txt
```

macOS:

```bash
base64 -i ca.crt
base64 -i user.crt
base64 -i user.key
base64 -i tls.key
base64 -i secret.txt
```

Add the resulting values under **Repository settings > Secrets and variables >
Actions** using the names shown above.

The optional `secret.txt` file normally contains the VPN username and password
on separate lines:

```text
vpn-username
vpn-password
```

See [example.ovpn](./example.ovpn) for a basic configuration layout.

## Security guidance

- Run the action only with a trusted `.ovpn` configuration.
- Store credentials in GitHub Secrets, never directly in workflow YAML.
- Grant the workflow only the permissions it needs.
- Do not expose VPN secrets to workflows that execute untrusted pull-request
  code.
- Keep the cleanup step under `if: always()` so credential files are removed
  even when a later step fails.

## Development

Node.js 24 is required.

```bash
yarn install
yarn lint:check
yarn prettier:check
yarn build
```

Commit the regenerated `dist/index.js` whenever `index.js` or a runtime
dependency changes.
