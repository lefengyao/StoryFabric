// Build targets lower syntax, but Android 10 WebViews also need runtime APIs.
import 'core-js/actual/array/at'
import 'core-js/actual/array/find-last'
import 'core-js/actual/array/find-last-index'
import 'core-js/actual/array/to-sorted'
import 'core-js/actual/object/has-own'
import 'core-js/actual/string/replace-all'
import 'core-js/actual/url/can-parse'
import './legacyAbortSignal'
