import React from 'react'
import PropTypes from 'prop-types'
import hoistNonReactStatics from 'hoist-non-react-statics'
import deepmerge from 'deepmerge'

import { CHANNEL, DIRECTIONS } from 'react-with-direction/dist/constants'
import brcastShape from 'react-with-direction/dist/proptypes/brcast'

import ThemedStyleSheet from './ThemedStyleSheet'

// Add some named exports to assist in upgrading and for convenience
export const css = ThemedStyleSheet.resolveLTR
export const withStylesPropTypes = {
  styles: PropTypes.object.isRequired, // eslint-disable-line react/forbid-prop-types
  theme: PropTypes.object.isRequired, // eslint-disable-line react/forbid-prop-types
  css: PropTypes.func.isRequired,
}

function eqSet(as, bs) {
  if (as.size !== bs.size) return false
  for (var a of as) if (!bs.has(a)) return false
  return true
}

function is(x, y) {
  // SameValue algorithm
  if (x === y) {
    // Steps 1-5, 7-10
    // Steps 6.b-6.e: +0 != -0
    // Added the nonzero y check to make Flow happy, but it is redundant
    return x !== 0 || y !== 0 || 1 / x === 1 / y
  } else {
    if (x.size && y.size) {
      return eqSet(x, y)
    }
    // Step 6.a: NaN == NaN
    return x !== x && y !== y
  }
}

function shallowEqual(objA, objB) {
  if (is(objA, objB)) {
    return true
  }

  if (
    typeof objA !== 'object' ||
    objA === null ||
    typeof objB !== 'object' ||
    objB === null
  ) {
    return false
  }

  var keysA = Object.keys(objA)
  var keysB = Object.keys(objB)

  if (keysA.length !== keysB.length) {
    return false
  }

  // Test for A's keys different from B.
  for (var i = 0; i < keysA.length; i++) {
    if (
      !hasOwnProperty.call(objB, keysA[i]) ||
      !is(objA[keysA[i]], objB[keysA[i]])
    ) {
      return false
    }
  }

  return true
}

function shallowCompare(instance, nextProps, nextState) {
  return (
    !shallowEqual(instance.props, nextProps) ||
    !shallowEqual(instance.state, nextState)
  )
}

const EMPTY_STYLES = {}
const EMPTY_STYLES_FN = () => EMPTY_STYLES

function baseClass(pureComponent) {
  if (pureComponent) {
    if (!React.PureComponent) {
      throw new ReferenceError(
        'withStyles() pureComponent option requires React 15.3.0 or later',
      )
    }

    return React.PureComponent
  }

  return React.Component
}

const contextTypes = {
  [CHANNEL]: brcastShape,
}

const defaultDirection = DIRECTIONS.LTR

export function withStyles(
  styleFn,
  {
    stylesPropName = 'styles',
    themePropName = 'theme',
    cssPropName = 'css',
    flushBefore = false,
    pureComponent = false,
  } = {},
) {
  let styleDefLTR
  let styleDefRTL
  let currentThemeLTR
  let currentThemeRTL
  const BaseClass = baseClass(pureComponent)

  function getResolveMethod(direction) {
    return direction === DIRECTIONS.LTR
      ? ThemedStyleSheet.resolveLTR
      : ThemedStyleSheet.resolveRTL
  }

  function getCurrentTheme(direction) {
    return direction === DIRECTIONS.LTR ? currentThemeLTR : currentThemeRTL
  }

  function getStyleDef(direction, wrappedComponentName) {
    const currentTheme = getCurrentTheme(direction)
    let styleDef = direction === DIRECTIONS.LTR ? styleDefLTR : styleDefRTL

    const registeredTheme = ThemedStyleSheet.get()

    // Return the existing styles if they've already been defined
    // and if the theme used to create them corresponds to the theme
    // registered with ThemedStyleSheet
    if (styleDef && currentTheme === registeredTheme) {
      return styleDef
    }

    if (
      process.env.NODE_ENV !== 'production' &&
      typeof performance !== 'undefined' &&
      performance.mark !== undefined
    ) {
      performance.mark('react-with-styles.createStyles.start')
    }

    const isRTL = direction === DIRECTIONS.RTL

    if (isRTL) {
      styleDefRTL = styleFn
        ? ThemedStyleSheet.createRTL(styleFn)
        : EMPTY_STYLES_FN

      currentThemeRTL = registeredTheme
      styleDef = styleDefRTL
    } else {
      styleDefLTR = styleFn
        ? ThemedStyleSheet.createLTR(styleFn)
        : EMPTY_STYLES_FN

      currentThemeLTR = registeredTheme
      styleDef = styleDefLTR
    }

    if (
      process.env.NODE_ENV !== 'production' &&
      typeof performance !== 'undefined' &&
      performance.mark !== undefined
    ) {
      performance.mark('react-with-styles.createStyles.end')

      performance.measure(
        `\ud83d\udc69\u200d\ud83c\udfa8 withStyles(${wrappedComponentName}) [create styles]`,
        'react-with-styles.createStyles.start',
        'react-with-styles.createStyles.end',
      )
    }

    return styleDef
  }

  function getState(direction, wrappedComponentName) {
    return {
      resolveMethod: getResolveMethod(direction),
      styleDef: getStyleDef(direction, wrappedComponentName),
    }
  }

  return function withStylesHOC(WrappedComponent) {
    const wrappedComponentName =
      WrappedComponent.displayName || WrappedComponent.name || 'Component'

    // NOTE: Use a class here so components are ref-able if need be:
    // eslint-disable-next-line react/prefer-stateless-function
    class WithStyles extends React.Component {
      constructor(props, context) {
        super(props, context)

        const direction = this.context[CHANNEL]
          ? this.context[CHANNEL].getState()
          : defaultDirection

        this.state = getState(direction, wrappedComponentName)
      }

      componentDidMount() {
        if (this.context[CHANNEL]) {
          // subscribe to future direction changes
          this.channelUnsubscribe = this.context[CHANNEL].subscribe(
            (direction) => {
              this.setState(getState(direction, wrappedComponentName))
            },
          )
        }
      }

      shouldComponentUpdate(nextProps, nextState) {
        const compare = shallowCompare(this, nextProps, nextState)
        return compare
      }

      componentWillUnmount() {
        if (this.channelUnsubscribe) {
          this.channelUnsubscribe()
        }
      }

      render() {
        // As some components will depend on previous styles in
        // the component tree, we provide the option of flushing the
        // buffered styles (i.e. to a style tag) **before** the rendering
        // cycle begins.
        //
        // The interfaces provide the optional "flush" method which
        // is run in turn by ThemedStyleSheet.flush.
        if (flushBefore) {
          ThemedStyleSheet.flush()
        }

        const { resolveMethod, styleDef } = this.state

        return (
          <WrappedComponent
            {...this.props}
            {...{
              [themePropName]: ThemedStyleSheet.get(),
              [stylesPropName]: styleDef(),
              [cssPropName]: resolveMethod,
            }}
          />
        )
      }
    }

    WithStyles.WrappedComponent = WrappedComponent
    WithStyles.displayName = `withStyles(${wrappedComponentName})`
    WithStyles.contextTypes = contextTypes
    if (WrappedComponent.propTypes) {
      WithStyles.propTypes = deepmerge({}, WrappedComponent.propTypes)
      delete WithStyles.propTypes[stylesPropName]
      delete WithStyles.propTypes[themePropName]
      delete WithStyles.propTypes[cssPropName]
    }
    if (WrappedComponent.defaultProps) {
      WithStyles.defaultProps = deepmerge({}, WrappedComponent.defaultProps)
    }

    return hoistNonReactStatics(WithStyles, WrappedComponent)
  }
}
