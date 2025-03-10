import type { __ApiPreviewProps } from './api-utils'
import type { CustomRoutes } from '../lib/load-custom-routes'
import type { DomainLocale } from './config'
import type { DynamicRoutes, PageChecker, Route } from './router'
import type { FontManifest } from './font-utils'
import type { LoadComponentsReturnType } from './load-components'
import type { RouteMatch } from '../shared/lib/router/utils/route-matcher'
import type { MiddlewareRouteMatch } from '../shared/lib/router/utils/middleware-route-matcher'
import type { Params } from '../shared/lib/router/utils/route-matcher'
import type { NextConfig, NextConfigComplete } from './config-shared'
import type { NextParsedUrlQuery, NextUrlWithParsedQuery } from './request-meta'
import type { ParsedUrlQuery } from 'querystring'
import type { RenderOpts, RenderOptsPartial } from './render'
import type {
  ResponseCacheBase,
  ResponseCacheEntry,
  ResponseCacheValue,
} from './response-cache'
import type { UrlWithParsedQuery } from 'url'
import {
  NormalizeError,
  DecodeError,
  normalizeRepeatedSlashes,
  MissingStaticPage,
} from '../shared/lib/utils'
import type { PreviewData, ServerRuntime } from 'next/types'
import type { PagesManifest } from '../build/webpack/plugins/pages-manifest-plugin'
import type { BaseNextRequest, BaseNextResponse } from './base-http'
import type { PayloadOptions } from './send-payload'
import type { PrerenderManifest } from '../build'

import { parse as parseQs } from 'querystring'
import { format as formatUrl, parse as parseUrl } from 'url'
import { getRedirectStatus } from '../lib/redirect-status'
import {
  NEXT_BUILTIN_DOCUMENT,
  STATIC_STATUS_PAGES,
  TEMPORARY_REDIRECT_STATUS,
} from '../shared/lib/constants'
import { getSortedRoutes, isDynamicRoute } from '../shared/lib/router/utils'
import {
  setLazyProp,
  getCookieParser,
  checkIsManualRevalidate,
} from './api-utils'
import * as envConfig from '../shared/lib/runtime-config'
import Router from './router'

import { setRevalidateHeaders } from './send-payload/revalidate-headers'
import { execOnce } from '../shared/lib/utils'
import { isBlockedPage } from './utils'
import { isBot } from '../shared/lib/router/utils/is-bot'
import RenderResult from './render-result'
import { removeTrailingSlash } from '../shared/lib/router/utils/remove-trailing-slash'
import { denormalizePagePath } from '../shared/lib/page-path/denormalize-page-path'
import { normalizeLocalePath } from '../shared/lib/i18n/normalize-locale-path'
import * as Log from '../build/output/log'
import { detectDomainLocale } from '../shared/lib/i18n/detect-domain-locale'
import escapePathDelimiters from '../shared/lib/router/utils/escape-path-delimiters'
import { getUtils } from '../build/webpack/loaders/next-serverless-loader/utils'
import isError, { getProperError } from '../lib/is-error'
import { addRequestMeta, getRequestMeta } from './request-meta'

import { ImageConfigComplete } from '../shared/lib/image-config'
import { removePathPrefix } from '../shared/lib/router/utils/remove-path-prefix'
import { normalizeAppPath } from '../shared/lib/router/utils/app-paths'
import { getRouteMatcher } from '../shared/lib/router/utils/route-matcher'
import { getRouteRegex } from '../shared/lib/router/utils/route-regex'
import { getLocaleRedirect } from '../shared/lib/i18n/get-locale-redirect'
import { getHostname } from '../shared/lib/get-hostname'
import { parseUrl as parseUrlUtil } from '../shared/lib/router/utils/parse-url'
import { getNextPathnameInfo } from '../shared/lib/router/utils/get-next-pathname-info'
import { MiddlewareMatcher } from '../build/analysis/get-page-static-info'

export type FindComponentsResult = {
  components: LoadComponentsReturnType
  query: NextParsedUrlQuery
}

export interface RoutingItem {
  page: string
  match: RouteMatch
  re?: RegExp
}

export interface MiddlewareRoutingItem {
  page: string
  match: MiddlewareRouteMatch
  matchers?: MiddlewareMatcher[]
}

export interface Options {
  /**
   * Object containing the configuration next.config.js
   */
  conf: NextConfig
  /**
   * Set to false when the server was created by Next.js
   */
  customServer?: boolean
  /**
   * Tells if Next.js is running in dev mode
   */
  dev?: boolean
  /**
   * Where the Next project is located
   */
  dir?: string
  /**
   * Tells if Next.js is running in a Serverless platform
   */
  minimalMode?: boolean
  /**
   * Hide error messages containing server information
   */
  quiet?: boolean
  /**
   * The hostname the server is running behind
   */
  hostname?: string
  /**
   * The port the server is running behind
   */
  port?: number
  /**
   * The HTTP Server that Next.js is running behind
   */
  httpServer?: import('http').Server
}

export interface BaseRequestHandler {
  (
    req: BaseNextRequest,
    res: BaseNextResponse,
    parsedUrl?: NextUrlWithParsedQuery | undefined
  ): Promise<void>
}

export type RequestContext = {
  req: BaseNextRequest
  res: BaseNextResponse
  pathname: string
  query: NextParsedUrlQuery
  renderOpts: RenderOptsPartial
}

export class NoFallbackError extends Error {}

// Internal wrapper around build errors at development
// time, to prevent us from propagating or logging them
export class WrappedBuildError extends Error {
  innerError: Error

  constructor(innerError: Error) {
    super()
    this.innerError = innerError
  }
}

type ResponsePayload = {
  type: 'html' | 'json'
  body: RenderResult
  revalidateOptions?: any
}

export function prepareServerlessUrl(
  req: BaseNextRequest,
  query: ParsedUrlQuery
): void {
  const curUrl = parseUrl(req.url!, true)
  req.url = formatUrl({
    ...curUrl,
    search: undefined,
    query: {
      ...curUrl.query,
      ...query,
    },
  })
}

export default abstract class Server<ServerOptions extends Options = Options> {
  protected dir: string
  protected quiet: boolean
  protected nextConfig: NextConfigComplete
  protected distDir: string
  protected publicDir: string
  protected hasStaticDir: boolean
  protected pagesManifest?: PagesManifest
  protected appPathsManifest?: PagesManifest
  protected buildId: string
  protected minimalMode: boolean
  protected renderOpts: {
    poweredByHeader: boolean
    buildId: string
    generateEtags: boolean
    runtimeConfig?: { [key: string]: any }
    assetPrefix?: string
    canonicalBase: string
    dev?: boolean
    previewProps: __ApiPreviewProps
    customServer?: boolean
    ampOptimizerConfig?: { [key: string]: any }
    basePath: string
    optimizeFonts: boolean
    images: ImageConfigComplete
    fontManifest?: FontManifest
    disableOptimizedLoading?: boolean
    optimizeCss: any
    nextScriptWorkers: any
    locale?: string
    locales?: string[]
    defaultLocale?: string
    domainLocales?: DomainLocale[]
    distDir: string
    runtime?: ServerRuntime
    serverComponents?: boolean
    crossOrigin?: string
    supportsDynamicHTML?: boolean
    serverComponentManifest?: any
    serverCSSManifest?: any
    renderServerComponentData?: boolean
    serverComponentProps?: any
    largePageDataBytes?: number
  }
  protected serverOptions: ServerOptions
  private responseCache: ResponseCacheBase
  protected router: Router
  protected dynamicRoutes?: DynamicRoutes
  protected appPathRoutes?: Record<string, string[]>
  protected customRoutes: CustomRoutes
  protected serverComponentManifest?: any
  protected serverCSSManifest?: any
  public readonly hostname?: string
  public readonly port?: number

  protected abstract getPublicDir(): string
  protected abstract getHasStaticDir(): boolean
  protected abstract getPagesManifest(): PagesManifest | undefined
  protected abstract getAppPathsManifest(): PagesManifest | undefined
  protected abstract getBuildId(): string

  protected abstract getFilesystemPaths(): Set<string>
  protected abstract findPageComponents(params: {
    pathname: string
    query: NextParsedUrlQuery
    params: Params
    isAppPath: boolean
    appPaths?: string[] | null
    sriEnabled?: boolean
  }): Promise<FindComponentsResult | null>
  protected abstract getFontManifest(): FontManifest | undefined
  protected abstract getPrerenderManifest(): PrerenderManifest
  protected abstract getServerComponentManifest(): any
  protected abstract getServerCSSManifest(): any
  protected abstract attachRequestMeta(
    req: BaseNextRequest,
    parsedUrl: NextUrlWithParsedQuery
  ): void
  protected abstract getFallback(page: string): Promise<string>
  protected abstract getCustomRoutes(): CustomRoutes
  protected abstract hasPage(pathname: string): Promise<boolean>

  protected abstract generateRoutes(): {
    headers: Route[]
    rewrites: {
      beforeFiles: Route[]
      afterFiles: Route[]
      fallback: Route[]
    }
    fsRoutes: Route[]
    redirects: Route[]
    catchAllRoute: Route
    catchAllMiddleware: Route[]
    pageChecker: PageChecker
    useFileSystemPublicRoutes: boolean
    dynamicRoutes: DynamicRoutes | undefined
    nextConfig: NextConfig
  }

  protected abstract sendRenderResult(
    req: BaseNextRequest,
    res: BaseNextResponse,
    options: {
      result: RenderResult
      type: 'html' | 'json'
      generateEtags: boolean
      poweredByHeader: boolean
      options?: PayloadOptions
    }
  ): Promise<void>

  protected abstract runApi(
    req: BaseNextRequest,
    res: BaseNextResponse,
    query: ParsedUrlQuery,
    params: Params | undefined,
    page: string,
    builtPagePath: string
  ): Promise<boolean>

  protected abstract renderHTML(
    req: BaseNextRequest,
    res: BaseNextResponse,
    pathname: string,
    query: NextParsedUrlQuery,
    renderOpts: RenderOpts
  ): Promise<RenderResult | null>

  protected abstract handleCompression(
    req: BaseNextRequest,
    res: BaseNextResponse
  ): void

  protected abstract getResponseCache(options: {
    dev: boolean
  }): ResponseCacheBase

  protected abstract loadEnvConfig(params: {
    dev: boolean
    forceReload?: boolean
  }): void

  public constructor(options: ServerOptions) {
    const {
      dir = '.',
      quiet = false,
      conf,
      dev = false,
      minimalMode = false,
      customServer = true,
      hostname,
      port,
    } = options
    this.serverOptions = options

    this.dir =
      process.env.NEXT_RUNTIME === 'edge' ? dir : require('path').resolve(dir)

    this.quiet = quiet
    this.loadEnvConfig({ dev })

    // TODO: should conf be normalized to prevent missing
    // values from causing issues as this can be user provided
    this.nextConfig = conf as NextConfigComplete
    this.hostname = hostname
    this.port = port
    this.distDir =
      process.env.NEXT_RUNTIME === 'edge'
        ? this.nextConfig.distDir
        : require('path').join(this.dir, this.nextConfig.distDir)
    this.publicDir = this.getPublicDir()
    this.hasStaticDir = !minimalMode && this.getHasStaticDir()

    // Only serverRuntimeConfig needs the default
    // publicRuntimeConfig gets it's default in client/index.js
    const {
      serverRuntimeConfig = {},
      publicRuntimeConfig,
      assetPrefix,
      generateEtags,
    } = this.nextConfig

    this.buildId = this.getBuildId()
    this.minimalMode = minimalMode || !!process.env.NEXT_PRIVATE_MINIMAL_MODE

    const serverComponents = this.nextConfig.experimental.serverComponents
    this.serverComponentManifest = serverComponents
      ? this.getServerComponentManifest()
      : undefined
    this.serverCSSManifest = serverComponents
      ? this.getServerCSSManifest()
      : undefined

    this.renderOpts = {
      poweredByHeader: this.nextConfig.poweredByHeader,
      canonicalBase: this.nextConfig.amp.canonicalBase || '',
      buildId: this.buildId,
      generateEtags,
      previewProps: this.getPreviewProps(),
      customServer: customServer === true ? true : undefined,
      ampOptimizerConfig: this.nextConfig.experimental.amp?.optimizer,
      basePath: this.nextConfig.basePath,
      images: this.nextConfig.images,
      optimizeFonts: !!this.nextConfig.optimizeFonts && !dev,
      fontManifest:
        this.nextConfig.optimizeFonts && !dev
          ? this.getFontManifest()
          : undefined,
      optimizeCss: this.nextConfig.experimental.optimizeCss,
      nextScriptWorkers: this.nextConfig.experimental.nextScriptWorkers,
      disableOptimizedLoading: this.nextConfig.experimental.runtime
        ? true
        : this.nextConfig.experimental.disableOptimizedLoading,
      domainLocales: this.nextConfig.i18n?.domains,
      distDir: this.distDir,
      runtime: this.nextConfig.experimental.runtime,
      serverComponents,
      crossOrigin: this.nextConfig.crossOrigin
        ? this.nextConfig.crossOrigin
        : undefined,
      largePageDataBytes: this.nextConfig.experimental.largePageDataBytes,
    }

    // Only the `publicRuntimeConfig` key is exposed to the client side
    // It'll be rendered as part of __NEXT_DATA__ on the client side
    if (Object.keys(publicRuntimeConfig).length > 0) {
      this.renderOpts.runtimeConfig = publicRuntimeConfig
    }

    // Initialize next/config with the environment configuration
    envConfig.setConfig({
      serverRuntimeConfig,
      publicRuntimeConfig,
    })

    this.pagesManifest = this.getPagesManifest()
    this.appPathsManifest = this.getAppPathsManifest()

    this.customRoutes = this.getCustomRoutes()
    this.router = new Router(this.generateRoutes())
    this.setAssetPrefix(assetPrefix)

    this.responseCache = this.getResponseCache({ dev })
  }

  public logError(err: Error): void {
    if (this.quiet) return
    console.error(err)
  }

  private async handleRequest(
    req: BaseNextRequest,
    res: BaseNextResponse,
    parsedUrl?: NextUrlWithParsedQuery
  ): Promise<void> {
    try {
      const urlParts = (req.url || '').split('?')
      const urlNoQuery = urlParts[0]

      // this normalizes repeated slashes in the path e.g. hello//world ->
      // hello/world or backslashes to forward slashes, this does not
      // handle trailing slash as that is handled the same as a next.config.js
      // redirect
      if (urlNoQuery?.match(/(\\|\/\/)/)) {
        const cleanUrl = normalizeRepeatedSlashes(req.url!)
        res.redirect(cleanUrl, 308).body(cleanUrl).send()
        return
      }

      setLazyProp({ req: req as any }, 'cookies', getCookieParser(req.headers))

      // Parse url if parsedUrl not provided
      if (!parsedUrl || typeof parsedUrl !== 'object') {
        parsedUrl = parseUrl(req.url!, true)
      }

      // Parse the querystring ourselves if the user doesn't handle querystring parsing
      if (typeof parsedUrl.query === 'string') {
        parsedUrl.query = parseQs(parsedUrl.query)
      }

      this.attachRequestMeta(req, parsedUrl)

      const domainLocale = detectDomainLocale(
        this.nextConfig.i18n?.domains,
        getHostname(parsedUrl, req.headers)
      )

      const defaultLocale =
        domainLocale?.defaultLocale || this.nextConfig.i18n?.defaultLocale

      const url = parseUrlUtil(req.url.replace(/^\/+/, '/'))
      const pathnameInfo = getNextPathnameInfo(url.pathname, {
        nextConfig: this.nextConfig,
      })

      url.pathname = pathnameInfo.pathname

      if (pathnameInfo.basePath) {
        req.url = removePathPrefix(req.url!, this.nextConfig.basePath)
        addRequestMeta(req, '_nextHadBasePath', true)
      }

      if (
        this.minimalMode &&
        typeof req.headers['x-matched-path'] === 'string'
      ) {
        try {
          // x-matched-path is the source of truth, it tells what page
          // should be rendered because we don't process rewrites in minimalMode
          let matchedPath = new URL(
            req.headers['x-matched-path'],
            'http://localhost'
          ).pathname

          let urlPathname = new URL(req.url, 'http://localhost').pathname

          // For ISR  the URL is normalized to the prerenderPath so if
          // it's a data request the URL path will be the data URL,
          // basePath is already stripped by this point
          if (urlPathname.startsWith(`/_next/data/`)) {
            parsedUrl.query.__nextDataReq = '1'
          }
          const normalizedUrlPath = this.stripNextDataPath(urlPathname)
          matchedPath = this.stripNextDataPath(matchedPath, false)

          if (this.nextConfig.i18n) {
            const localeResult = normalizeLocalePath(
              matchedPath,
              this.nextConfig.i18n.locales
            )
            matchedPath = localeResult.pathname

            if (localeResult.detectedLocale) {
              parsedUrl.query.__nextLocale = localeResult.detectedLocale
            }
          }
          matchedPath = denormalizePagePath(matchedPath)
          let srcPathname = matchedPath

          if (
            !isDynamicRoute(srcPathname) &&
            !(await this.hasPage(removeTrailingSlash(srcPathname)))
          ) {
            for (const dynamicRoute of this.dynamicRoutes || []) {
              if (dynamicRoute.match(srcPathname)) {
                srcPathname = dynamicRoute.page
                break
              }
            }
          }

          const pageIsDynamic = isDynamicRoute(srcPathname)
          const utils = getUtils({
            pageIsDynamic,
            page: srcPathname,
            i18n: this.nextConfig.i18n,
            basePath: this.nextConfig.basePath,
            rewrites: this.customRoutes.rewrites,
          })
          // ensure parsedUrl.pathname includes URL before processing
          // rewrites or they won't match correctly
          if (defaultLocale && !pathnameInfo.locale) {
            parsedUrl.pathname = `/${defaultLocale}${parsedUrl.pathname}`
          }
          const pathnameBeforeRewrite = parsedUrl.pathname
          const rewriteParams = utils.handleRewrites(req, parsedUrl)
          const rewriteParamKeys = Object.keys(rewriteParams)
          const didRewrite = pathnameBeforeRewrite !== parsedUrl.pathname

          if (didRewrite) {
            addRequestMeta(req, '_nextRewroteUrl', parsedUrl.pathname!)
            addRequestMeta(req, '_nextDidRewrite', true)
          }

          // interpolate dynamic params and normalize URL if needed
          if (pageIsDynamic) {
            let params: ParsedUrlQuery | false = {}

            let paramsResult = utils.normalizeDynamicRouteParams(
              parsedUrl.query
            )

            // for prerendered ISR paths we attempt parsing the route
            // params from the URL directly as route-matches may not
            // contain the correct values due to the filesystem path
            // matching before the dynamic route has been matched
            if (
              !paramsResult.hasValidParams &&
              pageIsDynamic &&
              !isDynamicRoute(normalizedUrlPath)
            ) {
              let matcherParams = utils.dynamicRouteMatcher?.(normalizedUrlPath)

              if (matcherParams) {
                utils.normalizeDynamicRouteParams(matcherParams)
                Object.assign(paramsResult.params, matcherParams)
                paramsResult.hasValidParams = true
              }
            }

            if (paramsResult.hasValidParams) {
              params = paramsResult.params
            }

            if (
              req.headers['x-now-route-matches'] &&
              isDynamicRoute(matchedPath) &&
              !paramsResult.hasValidParams
            ) {
              const opts: Record<string, string> = {}
              const routeParams = utils.getParamsFromRouteMatches(
                req,
                opts,
                parsedUrl.query.__nextLocale || ''
              )

              if (opts.locale) {
                parsedUrl.query.__nextLocale = opts.locale
              }
              paramsResult = utils.normalizeDynamicRouteParams(
                routeParams,
                true
              )

              if (paramsResult.hasValidParams) {
                params = paramsResult.params
              }
            }

            // handle the actual dynamic route name being requested
            if (
              pageIsDynamic &&
              utils.defaultRouteMatches &&
              normalizedUrlPath === srcPathname &&
              !paramsResult.hasValidParams &&
              !utils.normalizeDynamicRouteParams({ ...params }, true)
                .hasValidParams
            ) {
              params = utils.defaultRouteMatches
            }

            if (params) {
              matchedPath = utils.interpolateDynamicPath(srcPathname, params)
              req.url = utils.interpolateDynamicPath(req.url!, params)
            }
            Object.assign(parsedUrl.query, params)
          }

          if (pageIsDynamic || didRewrite) {
            utils.normalizeVercelUrl(req, true, [
              ...rewriteParamKeys,
              ...Object.keys(utils.defaultRouteRegex?.groups || {}),
            ])
          }
          parsedUrl.pathname = `${this.nextConfig.basePath || ''}${
            matchedPath === '/' && this.nextConfig.basePath ? '' : matchedPath
          }`
          url.pathname = parsedUrl.pathname
        } catch (err) {
          if (err instanceof DecodeError || err instanceof NormalizeError) {
            res.statusCode = 400
            return this.renderError(null, req, res, '/_error', {})
          }
          throw err
        }
      }

      addRequestMeta(req, '__nextHadTrailingSlash', pathnameInfo.trailingSlash)
      addRequestMeta(req, '__nextIsLocaleDomain', Boolean(domainLocale))
      parsedUrl.query.__nextDefaultLocale = defaultLocale

      if (pathnameInfo.locale) {
        req.url = formatUrl(url)
        addRequestMeta(req, '__nextStrippedLocale', true)
      }

      if (!this.minimalMode || !parsedUrl.query.__nextLocale) {
        if (pathnameInfo.locale || defaultLocale) {
          parsedUrl.query.__nextLocale = pathnameInfo.locale || defaultLocale
        }
      }

      if (!this.minimalMode && defaultLocale) {
        const redirect = getLocaleRedirect({
          defaultLocale,
          domainLocale,
          headers: req.headers,
          nextConfig: this.nextConfig,
          pathLocale: pathnameInfo.locale,
          urlParsed: {
            ...url,
            pathname: pathnameInfo.locale
              ? `/${pathnameInfo.locale}${url.pathname}`
              : url.pathname,
          },
        })

        if (redirect) {
          return res
            .redirect(redirect, TEMPORARY_REDIRECT_STATUS)
            .body(redirect)
            .send()
        }
      }

      res.statusCode = 200
      return await this.run(req, res, parsedUrl)
    } catch (err: any) {
      if (
        (err && typeof err === 'object' && err.code === 'ERR_INVALID_URL') ||
        err instanceof DecodeError ||
        err instanceof NormalizeError
      ) {
        res.statusCode = 400
        return this.renderError(null, req, res, '/_error', {})
      }

      if (this.minimalMode || this.renderOpts.dev) {
        throw err
      }
      this.logError(getProperError(err))
      res.statusCode = 500
      res.body('Internal Server Error').send()
    }
  }

  public getRequestHandler(): BaseRequestHandler {
    return this.handleRequest.bind(this)
  }

  protected async handleUpgrade(
    _req: BaseNextRequest,
    _socket: any,
    _head?: any
  ): Promise<void> {}

  public setAssetPrefix(prefix?: string): void {
    this.renderOpts.assetPrefix = prefix ? prefix.replace(/\/$/, '') : ''
  }

  // Backwards compatibility
  public async prepare(): Promise<void> {}

  // Backwards compatibility
  protected async close(): Promise<void> {}

  protected getPreviewProps(): __ApiPreviewProps {
    return this.getPrerenderManifest().preview
  }

  protected async _beforeCatchAllRender(
    _req: BaseNextRequest,
    _res: BaseNextResponse,
    _params: Params,
    _parsedUrl: UrlWithParsedQuery
  ): Promise<boolean> {
    return false
  }

  protected getDynamicRoutes(): Array<RoutingItem> {
    const addedPages = new Set<string>()

    return getSortedRoutes(
      [
        ...Object.keys(this.appPathRoutes || {}),
        ...Object.keys(this.pagesManifest!),
      ].map(
        (page) =>
          normalizeLocalePath(page, this.nextConfig.i18n?.locales).pathname
      )
    )
      .map((page) => {
        if (addedPages.has(page) || !isDynamicRoute(page)) return null
        addedPages.add(page)
        return {
          page,
          match: getRouteMatcher(getRouteRegex(page)),
        }
      })
      .filter((item): item is RoutingItem => Boolean(item))
  }

  protected getAppPathRoutes(): Record<string, string[]> {
    const appPathRoutes: Record<string, string[]> = {}

    Object.keys(this.appPathsManifest || {}).forEach((entry) => {
      const normalizedPath = normalizeAppPath(entry) || '/'
      if (!appPathRoutes[normalizedPath]) {
        appPathRoutes[normalizedPath] = []
      }
      appPathRoutes[normalizedPath].push(entry)
    })
    return appPathRoutes
  }

  protected async run(
    req: BaseNextRequest,
    res: BaseNextResponse,
    parsedUrl: UrlWithParsedQuery
  ): Promise<void> {
    this.handleCompression(req, res)

    try {
      const matched = await this.router.execute(req, res, parsedUrl)
      if (matched) {
        return
      }
    } catch (err) {
      if (err instanceof DecodeError || err instanceof NormalizeError) {
        res.statusCode = 400
        return this.renderError(null, req, res, '/_error', {})
      }
      throw err
    }

    await this.render404(req, res, parsedUrl)
  }

  private async pipe(
    fn: (ctx: RequestContext) => Promise<ResponsePayload | null>,
    partialContext: {
      req: BaseNextRequest
      res: BaseNextResponse
      pathname: string
      query: NextParsedUrlQuery
    }
  ): Promise<void> {
    const isBotRequest = isBot(partialContext.req.headers['user-agent'] || '')
    const ctx = {
      ...partialContext,
      renderOpts: {
        ...this.renderOpts,
        supportsDynamicHTML: !isBotRequest,
      },
    } as const
    const payload = await fn(ctx)
    if (payload === null) {
      return
    }
    const { req, res } = ctx
    const { body, type, revalidateOptions } = payload
    if (!res.sent) {
      const { generateEtags, poweredByHeader, dev } = this.renderOpts
      if (dev) {
        // In dev, we should not cache pages for any reason.
        res.setHeader('Cache-Control', 'no-store, must-revalidate')
      }
      return this.sendRenderResult(req, res, {
        result: body,
        type,
        generateEtags,
        poweredByHeader,
        options: revalidateOptions,
      })
    }
  }

  private async getStaticHTML(
    fn: (ctx: RequestContext) => Promise<ResponsePayload | null>,
    partialContext: {
      req: BaseNextRequest
      res: BaseNextResponse
      pathname: string
      query: ParsedUrlQuery
    }
  ): Promise<string | null> {
    const payload = await fn({
      ...partialContext,
      renderOpts: {
        ...this.renderOpts,
        supportsDynamicHTML: false,
      },
    })
    if (payload === null) {
      return null
    }
    return payload.body.toUnchunkedString()
  }

  public async render(
    req: BaseNextRequest,
    res: BaseNextResponse,
    pathname: string,
    query: NextParsedUrlQuery = {},
    parsedUrl?: NextUrlWithParsedQuery,
    internalRender = false
  ): Promise<void> {
    if (!pathname.startsWith('/')) {
      console.warn(
        `Cannot render page with path "${pathname}", did you mean "/${pathname}"?. See more info here: https://nextjs.org/docs/messages/render-no-starting-slash`
      )
    }

    if (
      this.renderOpts.customServer &&
      pathname === '/index' &&
      !(await this.hasPage('/index'))
    ) {
      // maintain backwards compatibility for custom server
      // (see custom-server integration tests)
      pathname = '/'
    }

    // we allow custom servers to call render for all URLs
    // so check if we need to serve a static _next file or not.
    // we don't modify the URL for _next/data request but still
    // call render so we special case this to prevent an infinite loop
    if (
      !internalRender &&
      !this.minimalMode &&
      !query.__nextDataReq &&
      (req.url?.match(/^\/_next\//) ||
        (this.hasStaticDir && req.url!.match(/^\/static\//)))
    ) {
      return this.handleRequest(req, res, parsedUrl)
    }

    // Custom server users can run `app.render()` which needs compression.
    if (this.renderOpts.customServer) {
      this.handleCompression(req, res)
    }

    if (isBlockedPage(pathname)) {
      return this.render404(req, res, parsedUrl)
    }

    return this.pipe((ctx) => this.renderToResponse(ctx), {
      req,
      res,
      pathname,
      query,
    })
  }

  protected async getStaticPaths(pathname: string): Promise<{
    staticPaths: string[] | undefined
    fallbackMode: 'static' | 'blocking' | false
  }> {
    // `staticPaths` is intentionally set to `undefined` as it should've
    // been caught when checking disk data.
    const staticPaths = undefined

    // Read whether or not fallback should exist from the manifest.
    const fallbackField =
      this.getPrerenderManifest().dynamicRoutes[pathname].fallback

    return {
      staticPaths,
      fallbackMode:
        typeof fallbackField === 'string'
          ? 'static'
          : fallbackField === null
          ? 'blocking'
          : false,
    }
  }

  private async renderToResponseWithComponents(
    { req, res, pathname, renderOpts: opts }: RequestContext,
    { components, query }: FindComponentsResult
  ): Promise<ResponsePayload | null> {
    const is404Page = pathname === '/404'
    const is500Page = pathname === '/500'

    const isLikeServerless =
      typeof components.ComponentMod === 'object' &&
      typeof (components.ComponentMod as any).renderReqToHTML === 'function'
    const hasServerProps = !!components.getServerSideProps
    const hasStaticPaths = !!components.getStaticPaths
    const hasGetInitialProps = !!components.Component?.getInitialProps
    const isServerComponent = !!components.ComponentMod?.__next_rsc__
    const isSSG =
      !!components.getStaticProps ||
      // For static server component pages, we currently always consider them
      // as SSG since we also need to handle the next data (flight JSON).
      (isServerComponent &&
        !hasServerProps &&
        !hasGetInitialProps &&
        process.env.NEXT_RUNTIME !== 'edge')

    // Toggle whether or not this is a Data request
    const isDataReq =
      !!(
        query.__nextDataReq ||
        (req.headers['x-nextjs-data'] &&
          (this.serverOptions as any).webServerConfig)
      ) &&
      (isSSG || hasServerProps || isServerComponent)

    delete query.__nextDataReq

    // normalize req.url for SSG paths as it is not exposed
    // to getStaticProps and the asPath should not expose /_next/data
    if (
      isSSG &&
      this.minimalMode &&
      req.headers['x-matched-path'] &&
      req.url.startsWith('/_next/data')
    ) {
      req.url = this.stripNextDataPath(req.url)
    }

    if (
      !isServerComponent &&
      !!req.headers['x-nextjs-data'] &&
      (!res.statusCode || res.statusCode === 200)
    ) {
      res.setHeader(
        'x-nextjs-matched-path',
        `${query.__nextLocale ? `/${query.__nextLocale}` : ''}${pathname}`
      )
    }

    // Don't delete query.__flight__ yet, it still needs to be used in renderToHTML later
    const isFlightRequest = Boolean(
      this.serverComponentManifest && query.__flight__
    )

    // we need to ensure the status code if /404 is visited directly
    if (is404Page && !isDataReq && !isFlightRequest) {
      res.statusCode = 404
    }

    // ensure correct status is set when visiting a status page
    // directly e.g. /500
    if (STATIC_STATUS_PAGES.includes(pathname)) {
      res.statusCode = parseInt(pathname.slice(1), 10)
    }

    // static pages can only respond to GET/HEAD
    // requests so ensure we respond with 405 for
    // invalid requests
    if (
      !is404Page &&
      !is500Page &&
      pathname !== '/_error' &&
      req.method !== 'HEAD' &&
      req.method !== 'GET' &&
      (typeof components.Component === 'string' || isSSG)
    ) {
      res.statusCode = 405
      res.setHeader('Allow', ['GET', 'HEAD'])
      await this.renderError(null, req, res, pathname)
      return null
    }

    // handle static page
    if (typeof components.Component === 'string') {
      return {
        type: 'html',
        // TODO: Static pages should be serialized as RenderResult
        body: RenderResult.fromStatic(components.Component),
      }
    }

    if (!query.amp) {
      delete query.amp
    }

    if (opts.supportsDynamicHTML === true) {
      const isBotRequest = isBot(req.headers['user-agent'] || '')
      const isSupportedDocument =
        typeof components.Document?.getInitialProps !== 'function' ||
        // When concurrent features is enabled, the built-in `Document`
        // component also supports dynamic HTML.
        (!!process.env.__NEXT_REACT_ROOT &&
          NEXT_BUILTIN_DOCUMENT in components.Document)

      // Disable dynamic HTML in cases that we know it won't be generated,
      // so that we can continue generating a cache key when possible.
      opts.supportsDynamicHTML =
        !isSSG &&
        !isLikeServerless &&
        !isBotRequest &&
        !query.amp &&
        isSupportedDocument
    }

    const defaultLocale = isSSG
      ? this.nextConfig.i18n?.defaultLocale
      : query.__nextDefaultLocale

    const locale = query.__nextLocale
    const locales = this.nextConfig.i18n?.locales

    let previewData: PreviewData
    let isPreviewMode = false

    if (hasServerProps || isSSG) {
      // For the edge runtime, we don't support preview mode in SSG.
      if (process.env.NEXT_RUNTIME !== 'edge') {
        const { tryGetPreviewData } =
          require('./api-utils/node') as typeof import('./api-utils/node')
        previewData = tryGetPreviewData(req, res, this.renderOpts.previewProps)
        isPreviewMode = previewData !== false
      }
    }

    let isManualRevalidate = false
    let revalidateOnlyGenerated = false

    if (isSSG) {
      ;({ isManualRevalidate, revalidateOnlyGenerated } =
        checkIsManualRevalidate(req, this.renderOpts.previewProps))
    }

    // Compute the iSSG cache key. We use the rewroteUrl since
    // pages with fallback: false are allowed to be rewritten to
    // and we need to look up the path by the rewritten path
    let urlPathname = parseUrl(req.url || '').pathname || '/'

    let resolvedUrlPathname =
      getRequestMeta(req, '_nextRewroteUrl') || urlPathname

    if (isSSG && this.minimalMode && req.headers['x-matched-path']) {
      // the url value is already correct when the matched-path header is set
      resolvedUrlPathname = urlPathname
    }

    urlPathname = removeTrailingSlash(urlPathname)
    resolvedUrlPathname = normalizeLocalePath(
      removeTrailingSlash(resolvedUrlPathname),
      this.nextConfig.i18n?.locales
    ).pathname

    const handleRedirect = (pageData: any) => {
      const redirect = {
        destination: pageData.pageProps.__N_REDIRECT,
        statusCode: pageData.pageProps.__N_REDIRECT_STATUS,
        basePath: pageData.pageProps.__N_REDIRECT_BASE_PATH,
      }
      const statusCode = getRedirectStatus(redirect)
      const { basePath } = this.nextConfig

      if (
        basePath &&
        redirect.basePath !== false &&
        redirect.destination.startsWith('/')
      ) {
        redirect.destination = `${basePath}${redirect.destination}`
      }

      if (redirect.destination.startsWith('/')) {
        redirect.destination = normalizeRepeatedSlashes(redirect.destination)
      }

      res
        .redirect(redirect.destination, statusCode)
        .body(redirect.destination)
        .send()
    }

    // remove /_next/data prefix from urlPathname so it matches
    // for direct page visit and /_next/data visit
    if (isDataReq) {
      resolvedUrlPathname = this.stripNextDataPath(resolvedUrlPathname)
      urlPathname = this.stripNextDataPath(urlPathname)
    }

    let ssgCacheKey =
      isPreviewMode || !isSSG || opts.supportsDynamicHTML || isFlightRequest
        ? null // Preview mode, manual revalidate, flight request can bypass the cache
        : `${locale ? `/${locale}` : ''}${
            (pathname === '/' || resolvedUrlPathname === '/') && locale
              ? ''
              : resolvedUrlPathname
          }${query.amp ? '.amp' : ''}`

    if ((is404Page || is500Page) && isSSG) {
      ssgCacheKey = `${locale ? `/${locale}` : ''}${pathname}${
        query.amp ? '.amp' : ''
      }`
    }

    if (ssgCacheKey) {
      // we only encode path delimiters for path segments from
      // getStaticPaths so we need to attempt decoding the URL
      // to match against and only escape the path delimiters
      // this allows non-ascii values to be handled e.g. Japanese characters

      // TODO: investigate adding this handling for non-SSG pages so
      // non-ascii names work there also
      ssgCacheKey = ssgCacheKey
        .split('/')
        .map((seg) => {
          try {
            seg = escapePathDelimiters(decodeURIComponent(seg), true)
          } catch (_) {
            // An improperly encoded URL was provided
            throw new DecodeError('failed to decode param')
          }
          return seg
        })
        .join('/')

      // ensure /index and / is normalized to one key
      ssgCacheKey =
        ssgCacheKey === '/index' && pathname === '/' ? '/' : ssgCacheKey
    }

    const doRender: () => Promise<ResponseCacheEntry | null> = async () => {
      let pageData: any
      let body: RenderResult | null
      let sprRevalidate: number | false
      let isNotFound: boolean | undefined
      let isRedirect: boolean | undefined

      // handle serverless
      if (isLikeServerless) {
        const renderResult = await (
          components.ComponentMod as any
        ).renderReqToHTML(req, res, 'passthrough', {
          locale,
          locales,
          defaultLocale,
          optimizeCss: this.renderOpts.optimizeCss,
          nextScriptWorkers: this.renderOpts.nextScriptWorkers,
          distDir: this.distDir,
          fontManifest: this.renderOpts.fontManifest,
          domainLocales: this.renderOpts.domainLocales,
        })

        body = renderResult.html
        pageData = renderResult.renderOpts.pageData
        sprRevalidate = renderResult.renderOpts.revalidate
        isNotFound = renderResult.renderOpts.isNotFound
        isRedirect = renderResult.renderOpts.isRedirect
      } else {
        const origQuery = parseUrl(req.url || '', true).query

        // clear any dynamic route params so they aren't in
        // the resolvedUrl
        if (opts.params) {
          Object.keys(opts.params).forEach((key) => {
            delete origQuery[key]
          })
        }
        const hadTrailingSlash =
          urlPathname !== '/' && this.nextConfig.trailingSlash

        const resolvedUrl = formatUrl({
          pathname: `${resolvedUrlPathname}${hadTrailingSlash ? '/' : ''}`,
          // make sure to only add query values from original URL
          query: origQuery,
        })

        const renderOpts: RenderOpts = {
          ...components,
          ...opts,
          isDataReq,
          resolvedUrl,
          locale,
          locales,
          defaultLocale,
          // For getServerSideProps and getInitialProps we need to ensure we use the original URL
          // and not the resolved URL to prevent a hydration mismatch on
          // asPath
          resolvedAsPath:
            hasServerProps || hasGetInitialProps
              ? formatUrl({
                  // we use the original URL pathname less the _next/data prefix if
                  // present
                  pathname: `${urlPathname}${hadTrailingSlash ? '/' : ''}`,
                  query: origQuery,
                })
              : resolvedUrl,
        }

        const renderResult = await this.renderHTML(
          req,
          res,
          pathname,
          query,
          renderOpts
        )

        body = renderResult
        // TODO: change this to a different passing mechanism
        pageData = (renderOpts as any).pageData
        sprRevalidate = (renderOpts as any).revalidate
        isNotFound = (renderOpts as any).isNotFound
        isRedirect = (renderOpts as any).isRedirect
      }

      let value: ResponseCacheValue | null
      if (isNotFound) {
        value = null
      } else if (isRedirect) {
        value = { kind: 'REDIRECT', props: pageData }
      } else {
        if (!body) {
          return null
        }
        value = { kind: 'PAGE', html: body, pageData }
      }
      return { revalidate: sprRevalidate, value }
    }

    const cacheEntry = await this.responseCache.get(
      ssgCacheKey,
      async (hasResolved, hadCache) => {
        const isProduction = !this.renderOpts.dev
        const isDynamicPathname = isDynamicRoute(pathname)
        const didRespond = hasResolved || res.sent

        let { staticPaths, fallbackMode } = hasStaticPaths
          ? await this.getStaticPaths(pathname)
          : { staticPaths: undefined, fallbackMode: false }

        if (
          fallbackMode === 'static' &&
          isBot(req.headers['user-agent'] || '')
        ) {
          fallbackMode = 'blocking'
        }

        // skip manual revalidate if cache is not present and
        // revalidate-if-generated is set
        if (
          isManualRevalidate &&
          revalidateOnlyGenerated &&
          !hadCache &&
          !this.minimalMode
        ) {
          await this.render404(req, res)
          return null
        }

        // only allow manual revalidate for fallback: true/blocking
        // or for prerendered fallback: false paths
        if (isManualRevalidate && (fallbackMode !== false || hadCache)) {
          fallbackMode = 'blocking'
        }

        // When we did not respond from cache, we need to choose to block on
        // rendering or return a skeleton.
        //
        // * Data requests always block.
        //
        // * Blocking mode fallback always blocks.
        //
        // * Preview mode toggles all pages to be resolved in a blocking manner.
        //
        // * Non-dynamic pages should block (though this is an impossible
        //   case in production).
        //
        // * Dynamic pages should return their skeleton if not defined in
        //   getStaticPaths, then finish the data request on the client-side.
        //
        if (
          this.minimalMode !== true &&
          fallbackMode !== 'blocking' &&
          ssgCacheKey &&
          !didRespond &&
          !isPreviewMode &&
          isDynamicPathname &&
          // Development should trigger fallback when the path is not in
          // `getStaticPaths`
          (isProduction ||
            !staticPaths ||
            !staticPaths.includes(
              // we use ssgCacheKey here as it is normalized to match the
              // encoding from getStaticPaths along with including the locale
              query.amp ? ssgCacheKey.replace(/\.amp$/, '') : ssgCacheKey
            ))
        ) {
          if (
            // In development, fall through to render to handle missing
            // getStaticPaths.
            (isProduction || staticPaths) &&
            // When fallback isn't present, abort this render so we 404
            fallbackMode !== 'static'
          ) {
            throw new NoFallbackError()
          }

          if (!isDataReq) {
            // Production already emitted the fallback as static HTML.
            if (isProduction) {
              const html = await this.getFallback(
                locale ? `/${locale}${pathname}` : pathname
              )
              return {
                value: {
                  kind: 'PAGE',
                  html: RenderResult.fromStatic(html),
                  pageData: {},
                },
              }
            }
            // We need to generate the fallback on-demand for development.
            else {
              query.__nextFallback = 'true'
              if (isLikeServerless) {
                prepareServerlessUrl(req, query)
              }
              const result = await doRender()
              if (!result) {
                return null
              }
              // Prevent caching this result
              delete result.revalidate
              return result
            }
          }
        }

        const result = await doRender()
        if (!result) {
          return null
        }
        return {
          ...result,
          revalidate:
            result.revalidate !== undefined
              ? result.revalidate
              : /* default to minimum revalidate (this should be an invariant) */ 1,
        }
      },
      {
        isManualRevalidate,
        isPrefetch: req.headers.purpose === 'prefetch',
      }
    )

    if (!cacheEntry) {
      if (ssgCacheKey && !(isManualRevalidate && revalidateOnlyGenerated)) {
        // A cache entry might not be generated if a response is written
        // in `getInitialProps` or `getServerSideProps`, but those shouldn't
        // have a cache key. If we do have a cache key but we don't end up
        // with a cache entry, then either Next.js or the application has a
        // bug that needs fixing.
        throw new Error('invariant: cache entry required but not generated')
      }
      return null
    }

    if (isSSG && !this.minimalMode) {
      // set x-nextjs-cache header to match the header
      // we set for the image-optimizer
      res.setHeader(
        'x-nextjs-cache',
        isManualRevalidate
          ? 'REVALIDATED'
          : cacheEntry.isMiss
          ? 'MISS'
          : cacheEntry.isStale
          ? 'STALE'
          : 'HIT'
      )
    }

    const { revalidate, value: cachedData } = cacheEntry
    const revalidateOptions: any =
      typeof revalidate !== 'undefined' &&
      (!this.renderOpts.dev || (hasServerProps && !isDataReq))
        ? {
            // When the page is 404 cache-control should not be added unless
            // we are rendering the 404 page for notFound: true which should
            // cache according to revalidate correctly
            private: isPreviewMode || (is404Page && cachedData),
            stateful: !isSSG,
            revalidate,
          }
        : undefined

    if (!cachedData) {
      if (revalidateOptions) {
        setRevalidateHeaders(res, revalidateOptions)
      }
      if (isDataReq) {
        res.statusCode = 404
        res.body('{"notFound":true}').send()
        return null
      } else {
        if (this.renderOpts.dev) {
          query.__nextNotFoundSrcPage = pathname
        }
        await this.render404(
          req,
          res,
          {
            pathname,
            query,
          } as UrlWithParsedQuery,
          false
        )
        return null
      }
    } else if (cachedData.kind === 'REDIRECT') {
      if (revalidateOptions) {
        setRevalidateHeaders(res, revalidateOptions)
      }
      if (isDataReq) {
        return {
          type: 'json',
          body: RenderResult.fromStatic(
            // @TODO: Handle flight data.
            JSON.stringify(cachedData.props)
          ),
          revalidateOptions,
        }
      } else {
        await handleRedirect(cachedData.props)
        return null
      }
    } else if (cachedData.kind === 'IMAGE') {
      throw new Error('invariant SSG should not return an image cache value')
    } else {
      return {
        type: isDataReq ? 'json' : 'html',
        body: isDataReq
          ? RenderResult.fromStatic(JSON.stringify(cachedData.pageData))
          : cachedData.html,
        revalidateOptions,
      }
    }
  }

  private stripNextDataPath(path: string, stripLocale = true) {
    if (path.includes(this.buildId)) {
      const splitPath = path.substring(
        path.indexOf(this.buildId) + this.buildId.length
      )

      path = denormalizePagePath(splitPath.replace(/\.json$/, ''))
    }

    if (this.nextConfig.i18n && stripLocale) {
      const { locales } = this.nextConfig.i18n
      return normalizeLocalePath(path, locales).pathname
    }
    return path
  }

  // map the route to the actual bundle name
  protected getOriginalAppPaths(route: string) {
    if (this.nextConfig.experimental.appDir) {
      const originalAppPath = this.appPathRoutes?.[route]

      if (!originalAppPath) {
        return null
      }

      return originalAppPath
    }
    return null
  }

  protected async renderPageComponent(
    ctx: RequestContext,
    bubbleNoFallback: boolean
  ) {
    const { query, pathname } = ctx

    const appPaths = this.getOriginalAppPaths(pathname)

    let page = pathname
    if (Array.isArray(appPaths)) {
      // When it's an array, we need to pass all parallel routes to the loader.
      page = appPaths[0]
    }

    const result = await this.findPageComponents({
      pathname: page,
      query,
      params: ctx.renderOpts.params || {},
      isAppPath: Array.isArray(appPaths),
      appPaths,
      sriEnabled: !!this.nextConfig.experimental.sri?.algorithm,
    })
    if (result) {
      try {
        return await this.renderToResponseWithComponents(ctx, result)
      } catch (err) {
        const isNoFallbackError = err instanceof NoFallbackError

        if (!isNoFallbackError || (isNoFallbackError && bubbleNoFallback)) {
          throw err
        }
      }
    }
    return false
  }

  private async renderToResponse(
    ctx: RequestContext
  ): Promise<ResponsePayload | null> {
    const { res, query, pathname } = ctx
    let page = pathname
    const bubbleNoFallback = !!query._nextBubbleNoFallback
    delete query._nextBubbleNoFallback

    try {
      // Ensure a request to the URL /accounts/[id] will be treated as a dynamic
      // route correctly and not loaded immediately without parsing params.
      if (!isDynamicRoute(page)) {
        const result = await this.renderPageComponent(ctx, bubbleNoFallback)
        if (result !== false) return result
      }

      if (this.dynamicRoutes) {
        for (const dynamicRoute of this.dynamicRoutes) {
          const params = dynamicRoute.match(pathname)
          if (!params) {
            continue
          }
          page = dynamicRoute.page
          const result = await this.renderPageComponent(
            {
              ...ctx,
              pathname: page,
              renderOpts: {
                ...ctx.renderOpts,
                params,
              },
            },
            bubbleNoFallback
          )
          if (result !== false) return result
        }
      }

      // currently edge functions aren't receiving the x-matched-path
      // header so we need to fallback to matching the current page
      // when we weren't able to match via dynamic route to handle
      // the rewrite case
      // @ts-expect-error extended in child class web-server
      if (this.serverOptions.webServerConfig) {
        // @ts-expect-error extended in child class web-server
        ctx.pathname = this.serverOptions.webServerConfig.page
        const result = await this.renderPageComponent(ctx, bubbleNoFallback)
        if (result !== false) return result
      }
    } catch (error) {
      const err = getProperError(error)

      if (error instanceof MissingStaticPage) {
        console.error(
          'Invariant: failed to load static page',
          JSON.stringify(
            {
              page,
              url: ctx.req.url,
              matchedPath: ctx.req.headers['x-matched-path'],
              initUrl: getRequestMeta(ctx.req, '__NEXT_INIT_URL'),
              didRewrite: getRequestMeta(ctx.req, '_nextDidRewrite'),
              rewroteUrl: getRequestMeta(ctx.req, '_nextRewroteUrl'),
            },
            null,
            2
          )
        )
        throw err
      }

      if (err instanceof NoFallbackError && bubbleNoFallback) {
        throw err
      }
      if (err instanceof DecodeError || err instanceof NormalizeError) {
        res.statusCode = 400
        return await this.renderErrorToResponse(ctx, err)
      }

      res.statusCode = 500

      // if pages/500 is present we still need to trigger
      // /_error `getInitialProps` to allow reporting error
      if (await this.hasPage('/500')) {
        ctx.query.__nextCustomErrorRender = '1'
        await this.renderErrorToResponse(ctx, err)
        delete ctx.query.__nextCustomErrorRender
      }

      const isWrappedError = err instanceof WrappedBuildError

      if (!isWrappedError) {
        if (
          (this.minimalMode && process.env.NEXT_RUNTIME !== 'edge') ||
          this.renderOpts.dev
        ) {
          if (isError(err)) err.page = page
          throw err
        }
        this.logError(getProperError(err))
      }
      const response = await this.renderErrorToResponse(
        ctx,
        isWrappedError ? (err as WrappedBuildError).innerError : err
      )
      return response
    }

    if (
      this.router.catchAllMiddleware[0] &&
      !!ctx.req.headers['x-nextjs-data'] &&
      (!res.statusCode || res.statusCode === 200 || res.statusCode === 404)
    ) {
      res.setHeader(
        'x-nextjs-matched-path',
        `${query.__nextLocale ? `/${query.__nextLocale}` : ''}${pathname}`
      )
      res.statusCode = 200
      res.setHeader('content-type', 'application/json')
      res.body('{}')
      res.send()
      return null
    }

    res.statusCode = 404
    return this.renderErrorToResponse(ctx, null)
  }

  public async renderToHTML(
    req: BaseNextRequest,
    res: BaseNextResponse,
    pathname: string,
    query: ParsedUrlQuery = {}
  ): Promise<string | null> {
    return this.getStaticHTML((ctx) => this.renderToResponse(ctx), {
      req,
      res,
      pathname,
      query,
    })
  }

  public async renderError(
    err: Error | null,
    req: BaseNextRequest,
    res: BaseNextResponse,
    pathname: string,
    query: NextParsedUrlQuery = {},
    setHeaders = true
  ): Promise<void> {
    if (setHeaders) {
      res.setHeader(
        'Cache-Control',
        'no-cache, no-store, max-age=0, must-revalidate'
      )
    }

    return this.pipe(
      async (ctx) => {
        const response = await this.renderErrorToResponse(ctx, err)
        if (this.minimalMode && res.statusCode === 500) {
          throw err
        }
        return response
      },
      { req, res, pathname, query }
    )
  }

  private customErrorNo404Warn = execOnce(() => {
    Log.warn(
      `You have added a custom /_error page without a custom /404 page. This prevents the 404 page from being auto statically optimized.\nSee here for info: https://nextjs.org/docs/messages/custom-error-no-custom-404`
    )
  })

  private async renderErrorToResponse(
    ctx: RequestContext,
    err: Error | null
  ): Promise<ResponsePayload | null> {
    const { res, query } = ctx
    try {
      let result: null | FindComponentsResult = null

      const is404 = res.statusCode === 404
      let using404Page = false

      // use static 404 page if available and is 404 response
      if (is404 && (await this.hasPage('/404'))) {
        result = await this.findPageComponents({
          pathname: '/404',
          query,
          params: {},
          isAppPath: false,
        })
        using404Page = result !== null
      }
      let statusPage = `/${res.statusCode}`

      if (
        !ctx.query.__nextCustomErrorRender &&
        !result &&
        STATIC_STATUS_PAGES.includes(statusPage)
      ) {
        // skip ensuring /500 in dev mode as it isn't used and the
        // dev overlay is used instead
        if (statusPage !== '/500' || !this.renderOpts.dev) {
          result = await this.findPageComponents({
            pathname: statusPage,
            query,
            params: {},
            isAppPath: false,
          })
        }
      }

      if (!result) {
        result = await this.findPageComponents({
          pathname: '/_error',
          query,
          params: {},
          isAppPath: false,
        })
        statusPage = '/_error'
      }

      if (
        process.env.NODE_ENV !== 'production' &&
        !using404Page &&
        (await this.hasPage('/_error')) &&
        !(await this.hasPage('/404'))
      ) {
        this.customErrorNo404Warn()
      }

      try {
        return await this.renderToResponseWithComponents(
          {
            ...ctx,
            pathname: statusPage,
            renderOpts: {
              ...ctx.renderOpts,
              err,
            },
          },
          result!
        )
      } catch (maybeFallbackError) {
        if (maybeFallbackError instanceof NoFallbackError) {
          throw new Error('invariant: failed to render error page')
        }
        throw maybeFallbackError
      }
    } catch (error) {
      const renderToHtmlError = getProperError(error)
      const isWrappedError = renderToHtmlError instanceof WrappedBuildError
      if (!isWrappedError) {
        this.logError(renderToHtmlError)
      }
      res.statusCode = 500
      const fallbackComponents = await this.getFallbackErrorComponents()

      if (fallbackComponents) {
        return this.renderToResponseWithComponents(
          {
            ...ctx,
            pathname: '/_error',
            renderOpts: {
              ...ctx.renderOpts,
              // We render `renderToHtmlError` here because `err` is
              // already captured in the stacktrace.
              err: isWrappedError
                ? renderToHtmlError.innerError
                : renderToHtmlError,
            },
          },
          {
            query,
            components: fallbackComponents,
          }
        )
      }
      return {
        type: 'html',
        body: RenderResult.fromStatic('Internal Server Error'),
      }
    }
  }

  public async renderErrorToHTML(
    err: Error | null,
    req: BaseNextRequest,
    res: BaseNextResponse,
    pathname: string,
    query: ParsedUrlQuery = {}
  ): Promise<string | null> {
    return this.getStaticHTML((ctx) => this.renderErrorToResponse(ctx, err), {
      req,
      res,
      pathname,
      query,
    })
  }

  protected async getFallbackErrorComponents(): Promise<LoadComponentsReturnType | null> {
    // The development server will provide an implementation for this
    return null
  }

  public async render404(
    req: BaseNextRequest,
    res: BaseNextResponse,
    parsedUrl?: NextUrlWithParsedQuery,
    setHeaders = true
  ): Promise<void> {
    const { pathname, query }: NextUrlWithParsedQuery = parsedUrl
      ? parsedUrl
      : parseUrl(req.url!, true)

    if (this.nextConfig.i18n) {
      query.__nextLocale =
        query.__nextLocale || this.nextConfig.i18n.defaultLocale
      query.__nextDefaultLocale =
        query.__nextDefaultLocale || this.nextConfig.i18n.defaultLocale
    }

    res.statusCode = 404
    return this.renderError(null, req, res, pathname!, query, setHeaders)
  }
}
