import type { webpack } from 'next/dist/compiled/webpack/webpack'
import type { NextConfigComplete } from '../../../server/config-shared'

export type ConfigurationContext = {
  supportedBrowsers: string[] | undefined
  rootDirectory: string
  customAppFile: RegExp | undefined

  isDevelopment: boolean
  isProduction: boolean

  isServer: boolean
  isClient: boolean
  isEdgeRuntime: boolean
  targetWeb: boolean

  assetPrefix: string

  sassOptions: any
  productionBrowserSourceMaps: boolean

  future: NextConfigComplete['future']
  experimental: NextConfigComplete['experimental']
}

export type ConfigurationFn = (
  a: webpack.Configuration
) => webpack.Configuration

export const pipe =
  <R>(...fns: Array<(a: R) => R | Promise<R>>) =>
  (param: R) =>
    fns.reduce(
      async (result: R | Promise<R>, next) => next(await result),
      param
    )
