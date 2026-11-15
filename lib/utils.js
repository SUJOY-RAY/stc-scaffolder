/** String utilities used by the STC bootstrapper. */

/** Convert kebab/snake to PascalCase. */
function toPascalCase(s) {
  return String(s)
    .split(/[-_]/)
    .map((p) => (p ? p.charAt(0).toUpperCase() + p.slice(1) : p))
    .join('');
}

/** Convert kebab/snake to camelCase. */
function toCamelCase(s) {
  const p = toPascalCase(s);
  return p ? p.charAt(0).toLowerCase() + p.slice(1) : p;
}

/** Map user field type to a Java type. */
function javaType(t) {
  const map = {
    string: 'String',
    int: 'Integer',
    integer: 'Integer',
    long: 'Long',
    boolean: 'Boolean',
    double: 'Double',
    bigdecimal: 'BigDecimal',
    instant: 'Instant',
  };
  return map[String(t).toLowerCase()] || 'String';
}

module.exports = { toPascalCase, toCamelCase, javaType };
