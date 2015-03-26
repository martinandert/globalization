'use strict';

var extend  = require('extend');
var isArray = require('util').isArray;
var isDate  = require('util').isDate;
var sprintf = require('sprintf').sprintf;
var events  = require('events');
var except  = require('except');

var strftime = require('./strftime');

var translationScope = 'counterpart';

function isString(val) {
  return typeof val === 'string' || Object.prototype.toString.call(val) === '[object String]';
}

function isFunction(val) {
  return typeof val === 'function' || Object.prototype.toString.call(val) === '[object Function]';
}

function isSymbol(key) {
  return isString(key) && key[0] === ':';
}

function Counterpart() {
  this._registry = {
    locale: 'en',
    fallbackLocale: 'en',
    scope: null,
    translations: {},
    interpolations: {},
    normalizedKeys: {},
    separator: '.'
  };

  this.registerTranslations('en', require('./locales/en'));
  this.setMaxListeners(0);
}

extend(Counterpart.prototype, events.EventEmitter.prototype);

Counterpart.prototype.getLocale = function() {
  return this._registry.locale;
};

Counterpart.prototype.setLocale = function(value) {
  var previous = this._registry.locale;

  if (previous != value) {
    this._registry.locale = value;
    this.emit('localechange', value, previous);
  }

  return previous;
};

Counterpart.prototype.getFallbackLocale = function() {
  return this._registry.fallbackLocale;
};

Counterpart.prototype.setFallbackLocale = function(value) {
  var previous = this._registry.fallbackLocale;

  if (previous != value) {
    this._registry.fallbackLocale = value;
    this.emit('fallbacklocalechange', value, previous);
  }

  return previous;
};

Counterpart.prototype.getSeparator = function() {
  return this._registry.separator;
};

Counterpart.prototype.setSeparator = function(value) {
  var previous = this._registry.separator;
  this._registry.separator = value;
  return previous;
};

Counterpart.prototype.registerTranslations = function(locale, data) {
  var translations = {};
  translations[locale] = data;
  extend(true, this._registry.translations, translations);
  return translations;
};

Counterpart.prototype.registerInterpolations = function(data) {
  return extend(true, this._registry.interpolations, data);
};

Counterpart.prototype.onLocaleChange =
Counterpart.prototype.addLocaleChangeListener = function(callback) {
  this.addListener('localechange', callback);
};

Counterpart.prototype.offLocaleChange =
Counterpart.prototype.removeLocaleChangeListener = function(callback) {
  this.removeListener('localechange', callback);
};

Counterpart.prototype.translate = function(key, options) {
  if (!isArray(key) && !isString(key) || !key.length) {
    throw new Error('invalid argument: key');
  }

  if (isSymbol(key)) {
    key = key.substr(1);
  }

  options = extend(true, {}, options);

  var locale = options.locale || this._registry.locale;
  delete options.locale;

  var scope = options.scope || this._registry.scope;
  delete options.scope;

  var separator = options.separator || this._registry.separator;
  delete options.separator;

  var keys = this._normalizeKeys(locale, scope, key, separator);

  var entry = keys.reduce(function(result, key) {
    if (Object.prototype.toString.call(result) === '[object Object]' && Object.prototype.hasOwnProperty.call(result, key)) {
      return result[key];
    } else {
      return null;
    }
  }, this._registry.translations);

  if (entry === null && options.fallback) {
    entry = this._fallback(locale, scope, key, options.fallback, options);
  }

  if (entry === null && locale != this._registry.fallbackLocale) {
    var keys2 = this._normalizeKeys(this._registry.fallbackLocale, scope, key, separator);
    entry = keys2.reduce(function(result, key) {
      if (Object.prototype.toString.call(result) === '[object Object]' && Object.prototype.hasOwnProperty.call(result, key)) {
        return result[key];
      } else {
        return null;
      }
    }, this._registry.translations);
    console.log('entry=', entry);
    if (entry !== null) {
      // Update locale to fallback locale
      locale = this._registry.fallbackLocal;
    }
  }
  
  if (entry === null) {
    entry = 'missing translation: ' + keys.join(separator);
  }

  entry = this._pluralize(locale, entry, options.count);

  if (options.interpolate !== false) {
    entry = this._interpolate(entry, options);
  }

  return entry;
};

Counterpart.prototype.localize = function(object, options) {
  if (!isDate(object)) {
    throw new Error('invalid argument: object must be a date');
  }

  options = extend(true, {}, options);

  var locale  = options.locale  || this._registry.locale;
  var scope   = options.scope   || translationScope;
  var type    = options.type    || 'datetime';
  var format  = options.format  || 'default';

  options = { locale: locale, scope: scope, interpolate: false };
  format  = this.translate(['formats', type, format], extend(true, {}, options));

  return strftime(object, format, this.translate('names', options));
};

Counterpart.prototype._pluralize = function(locale, entry, count) {
  if (typeof entry !== 'object' || entry === null || typeof count !== 'number') {
    return entry;
  }

  var pluralizeFunc = this.translate('pluralize', { locale: locale, scope: translationScope });

  if (Object.prototype.toString.call(pluralizeFunc) !== '[object Function]') {
    return pluralizeFunc;
  }

  return pluralizeFunc(entry, count);
};

Counterpart.prototype.withLocale = function(locale, callback, context) {
  var previous = this._registry.locale;
  this._registry.locale = locale;
  var result = callback.call(context);
  this._registry.locale = previous;
  return result;
};

Counterpart.prototype.withScope = function(scope, callback, context) {
  var previous = this._registry.scope;
  this._registry.scope = scope;
  var result = callback.call(context);
  this._registry.scope = previous;
  return result;
};

Counterpart.prototype.withSeparator = function(separator, callback, context) {
  var previous = this.setSeparator(separator);
  var result = callback.call(context);
  this.setSeparator(previous);
  return result;
};

Counterpart.prototype._normalizeKeys = function(locale, scope, key, separator) {
  var keys = [];

  keys = keys.concat(this._normalizeKey(locale, separator));
  keys = keys.concat(this._normalizeKey(scope, separator));
  keys = keys.concat(this._normalizeKey(key, separator));

  return keys;
};

Counterpart.prototype._normalizeKey = function(key, separator) {
  this._registry.normalizedKeys[separator] = this._registry.normalizedKeys[separator] || {};

  this._registry.normalizedKeys[separator][key] = this._registry.normalizedKeys[separator][key] || (function(key) {
    if (isArray(key)) {
      var normalizedKeyArray = key.map(function(k) { return this._normalizeKey(k, separator); }.bind(this));

      return [].concat.apply([], normalizedKeyArray);
    } else {
      if (typeof key === 'undefined' || key === null) {
        return [];
      }

      var keys = key.split(separator);

      for (var i = keys.length - 1; i >= 0; i--) {
        if (keys[i] === '') {
          keys.splice(i, 1);
        }
      }

      return keys;
    }
  }.bind(this))(key);

  return this._registry.normalizedKeys[separator][key];
};

Counterpart.prototype._interpolate = function(entry, values) {
  if (typeof entry !== 'string') {
    return entry;
  }

  return sprintf(entry, extend({}, this._registry.interpolations, values));
};

Counterpart.prototype._resolve = function(locale, scope, object, subject, options) {
  options = options || {};

  if (options.resolve === false) {
    return subject;
  }

  var result;

  if (isSymbol(subject)) {
    result = this.translate(subject, extend({}, options, { locale: locale, scope: scope }));
  } else if (isFunction(subject)) {
    var dateOrTime;

    if (options.object) {
      dateOrTime = options.object;
      delete options.object;
    } else {
      dateOrTime = object;
    }

    result = this._resolve(locale, scope, object, subject(dateOrTime, options));
  } else {
    result = subject;
  }

  return /^missing translation:/.test(result) ? null : result;
};

Counterpart.prototype._fallback = function(locale, scope, object, subject, options) {
  options = except(options, 'fallback');

  if (isArray(subject)) {
    for (var i = 0, ii = subject.length; i < ii; i++) {
      var result = this._resolve(locale, scope, object, subject[i], options);

      if (result) {
        return result;
      }
    }

    return null;
  } else {
    return this._resolve(locale, scope, object, subject, options);
  }
};

var instance = new Counterpart();

function translate() {
  return instance.translate.apply(instance, arguments);
}

extend(translate, instance, {
  Instance: Counterpart
});

module.exports = translate;
