import { pathToFileURL } from 'node:url'
import { testPdga } from '../server/pdga-client.mjs'
export { testPdga } from '../server/pdga-client.mjs'

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let input = ''
  try {
    if (process.argv.length !== 2 || process.stdin.isTTY) throw new Error('Use scripts\\test-pdga.ps1; do not pass credentials as arguments.')
    for await (const chunk of process.stdin) {
      input += chunk.toString('utf8')
      if (input.length > 16_384) throw new Error('Credential input exceeds limit.')
    }
    let credentials
    try { credentials = JSON.parse(input) } catch { throw new Error('Invalid credential input; contents suppressed.') }
    input = ''
    try { console.log(JSON.stringify(await testPdga(credentials), null, 2)) }
    finally { credentials.password = '' }
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'PDGA test failed; details suppressed.')
    process.exitCode = 1
  } finally { input = '' }
}
