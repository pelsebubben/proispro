import { defineConfig, devices } from '@playwright/test'

const baseURL = process.env.STAGING_URL
if (!baseURL || new URL(baseURL).protocol !== 'https:') throw new Error('STAGING_URL must be HTTPS')
if (!process.env.SOURCE_SHA?.match(/^[a-f0-9]{40}$/)) throw new Error('SOURCE_SHA must be a full commit SHA')

export default defineConfig({
  testDir: './tests/staging',
  forbidOnly: true,
  retries: 0,
  timeout: 30_000,
  reporter: [['list'], ['html', { outputFolder: 'staging-report', open: 'never' }],
    ['junit', { outputFile: 'staging-results/junit.xml' }]],
  outputDir: 'staging-results',
  use: { baseURL, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  metadata: { sourceSha: process.env.SOURCE_SHA, authentication: 'real sign-in disabled pending customer tenant' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
})
