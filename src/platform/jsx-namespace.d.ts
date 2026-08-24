import type { JSX as ReactJSX } from 'react'

/**
 * React 19 removed the global JSX namespace. This restores `JSX.Element`
 * as a type alias so platform components can keep concise return types.
 */
declare global {
  namespace JSX {
    type Element = ReactJSX.Element
    type ElementClass = ReactJSX.ElementClass
    type ElementAttributesProperty = ReactJSX.ElementAttributesProperty
    type ElementChildrenAttribute = ReactJSX.ElementChildrenAttribute
  }
}

export {}
