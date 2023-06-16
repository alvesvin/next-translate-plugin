import { ParsedFilePkg } from './types'
import {
  interceptExport,
  addLoadLocalesFrom,
  getNamedExport,
  clientLine,
  interceptNamedExportsFromReactComponents,
  INTERNAL_CONFIG_KEY,
} from './utils'

const defaultDynamicExport = `export const dynamic = 'force-dynamic';`
const hocName = '__withTranslationClientComponent'

export default function templateAppDir(
  pagePkg: ParsedFilePkg,
  {
    code = '',
    pageNoExt = '/',
    normalizedResourcePath = '',
    appFolder = '',
    isClientComponent = false,
  } = {}
) {
  const isPage =
    pageNoExt.endsWith('/page') && normalizedResourcePath.includes(appFolder)

  if (!isPage && !isClientComponent) return code

  const hash = Date.now().toString(16)
  const pathname = pageNoExt.replace('/page', '/')

  // Removes the export default from the page
  // and tells under what name we can get the old export
  const pageVariableName = interceptExport(
    pagePkg,
    'default',
    `__Next_Translate__Page__${hash}__`
  )

  const dynamicVariable = getNamedExport(pagePkg, 'dynamic', false)
  const dynamicExport = dynamicVariable ? '' : defaultDynamicExport

  if (isPage && !pageVariableName) return code

  // Get the new code after intercepting the export
  code = pagePkg.getCode()

  if (isClientComponent && !isPage)
    return templateAppDirClientComponent({ pagePkg, hash, pageVariableName })
  if (isClientComponent && isPage)
    return templateAppDirClientPage({
      pagePkg,
      hash,
      pageVariableName,
      pathname,
    })

  return `
    import ${INTERNAL_CONFIG_KEY} from '@next-translate-root/i18n'
    import __loadNamespaces from 'next-translate/loadNamespaces'
    ${code}

    globalThis.i18nConfig = ${INTERNAL_CONFIG_KEY}

    ${dynamicExport}

    export default async function __Next_Translate_new__${hash}__(props) {
      let config = { 
        ...${INTERNAL_CONFIG_KEY},
        locale: props.searchParams?.lang ?? props.params?.lang ?? ${INTERNAL_CONFIG_KEY}.defaultLocale,
        loaderName: \`\${dynamic} (server page)\`,
        pathname: '${pathname}',
        ${addLoadLocalesFrom()}
      }
  
      if (!globalThis.__NEXT_TRANSLATE__) {
        globalThis.__NEXT_TRANSLATE__ = {}
      }
  
      const { __lang, __namespaces } = await __loadNamespaces(config)
      globalThis.__NEXT_TRANSLATE__ = { lang: __lang, namespaces: __namespaces, pathname: '${pathname}' }

      return (
        <>
          <div 
            id="__NEXT_TRANSLATE_DATA__" 
            data-lang={__lang} 
            data-ns={JSON.stringify(__namespaces)}
            data-pathname="${pathname}"
          />
          <${pageVariableName} {...props} />
        </>
      )
    }
`
}

type ClientTemplateParams = {
  pagePkg: ParsedFilePkg
  hash: string
  pageVariableName: string
  pathname?: string
}

function templateAppDirClientComponent({
  pagePkg,
  hash,
  pageVariableName,
}: ClientTemplateParams) {
  const topLine = clientLine[0]
  const namedExportsModified = modifyNamedExportsComponents(pagePkg, hash)
  let clientCode = pagePkg.getCode()

  // Clear current "use client" top line
  clientLine.forEach((line) => {
    clientCode = clientCode.replace(line, '')
  })

  const defaultExportModified = pageVariableName
    ? `export default ${hocName}(${pageVariableName}, ${INTERNAL_CONFIG_KEY})`
    : ''

  return `${topLine}
    import ${INTERNAL_CONFIG_KEY} from '@next-translate-root/i18n'
    import * as __react from 'react'
    import ${hocName} from 'next-translate/withTranslationClientComponent'

    ${clientCode}

    ${defaultExportModified}
  
    ${namedExportsModified}
  `
}

function templateAppDirClientPage({
  pagePkg,
  hash,
  pageVariableName,
  pathname,
}: ClientTemplateParams) {
  const topLine = clientLine[0]
  let clientCode = pagePkg.getCode()

  // Clear current "use client" top line
  clientLine.forEach((line) => {
    clientCode = clientCode.replace(line, '')
  })

  return `${topLine}
    import ${INTERNAL_CONFIG_KEY} from '@next-translate-root/i18n'
    import __loadNamespaces, { log as __log } from 'next-translate/loadNamespaces'
    import { useSearchParams as __useSearchParams, useParams as __useParams } from 'next/navigation'
    import * as __react from 'react'

    ${clientCode}

    export default function __Next_Translate_new__${hash}__(props) {
      const forceUpdate = __react.useReducer(() => [])[1]
      const pathname = '${pathname}'
      const isServer = typeof window === 'undefined'
      const searchParams = __useSearchParams()
      const params = __useParams()
      let lang = searchParams.get('lang') ?? params.lang ?? ${INTERNAL_CONFIG_KEY}.defaultLocale

      const config = { 
        ...${INTERNAL_CONFIG_KEY},
        locale: lang,
        loaderName: 'useEffect (client page)',
        pathname,
        ${addLoadLocalesFrom()}
      }

      __react.useEffect(() => {
        const shouldLoad = lang !== window.__NEXT_TRANSLATE__?.lang || pathname !== window.__NEXT_TRANSLATE__?.pathname

        if (!shouldLoad) return

        __loadNamespaces(config).then(({ __lang, __namespaces }) => {
          window.__NEXT_TRANSLATE__ = { lang: __lang, namespaces: __namespaces || {}, pathname: '${pathname}' }
          window.i18nConfig = ${INTERNAL_CONFIG_KEY}
          forceUpdate()
        })
      }, [lang])

      if (isServer) {
        __log(config, { page: pathname, lang, namespaces: ['calculated in client-side'] })
        return null
      }

      if (!window.__NEXT_TRANSLATE__) return null

      return <${pageVariableName} {...props} />
    }
  `
}

function modifyNamedExportsComponents(pagePkg: ParsedFilePkg, hash: string) {
  return interceptNamedExportsFromReactComponents(pagePkg, hash)
    .map(
      ({ exportName, defaultLocalName }) => `
    const ${defaultLocalName} = ${hocName}(${exportName}, ${INTERNAL_CONFIG_KEY})
    export { ${defaultLocalName} as ${exportName} }
  `
    )
    .join('')
    .trim()
}
