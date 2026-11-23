const fs = require('fs');
const path = require('path');
const { detectPackage } = require('./crud');
const { toPascalCase, toCamelCase } = require('./utils');

/** Simple (scalar) Java types that can be displayed / searched directly. */
const SIMPLE_TYPES = new Set([
  'String', 'Integer', 'Long', 'int', 'long', 'Double', 'double', 'Float', 'float',
  'Boolean', 'boolean', 'Short', 'Byte', 'Character', 'char', 'BigDecimal', 'BigInteger',
  'Instant', 'LocalDateTime', 'LocalDate', 'LocalTime', 'OffsetDateTime', 'Date',
]);
/** Numeric / boolean types searchable by exact match. */
const EXACT_TYPES = new Set([
  'Integer', 'Long', 'int', 'long', 'Double', 'double', 'Float', 'float', 'Short', 'Byte',
  'BigDecimal', 'BigInteger', 'Boolean', 'boolean',
]);
/** java.time / Date types rendered with a formatter instead of raw toString. */
const DATE_TYPES = new Set(['Instant', 'LocalDateTime', 'LocalDate', 'LocalTime', 'OffsetDateTime', 'Date']);

function entityVar(name) { return toCamelCase(name); }
function pluralOf(name) { return entityVar(name) + 's'; }
function specsName(name) { return toPascalCase(name) + 'Specs'; }
function controllerName(name) { return toPascalCase(name) + 'WebController'; }

/** Turn a camelCase field name into a human-readable label. */
function labelOf(name) {
  if (/^id$/i.test(name)) return 'ID';
  return name
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Simple name of a (possibly generic / fully-qualified) Java type. */
function simpleNameOf(type) {
  const t = type.trim().replace(/[<>\\[\],\s]+/g, ' ').trim().split(/\s+/).pop();
  return t.split('.').pop();
}

/** Parse one entity .java file: class name + scalar fields. */
function parseEntityFile(content) {
  const lines = content.split(/\r?\n/);
  let className = null;
  const fields = [];
  let annBuf = [];
  const fieldRe = /^\s*(private|public|protected)\s+(?!static\b)(final\s+)?([\w.<>\[\],\s]+?)\s+([A-Za-z_]\w*)\s*;\s*$/;
  const columnRe = /@Column\s*\(\s*name\s*=\s*"([^"]+)"\s*\)/;

  const isBreakLine = (trimmed) => {
    if (!trimmed) return false;
    if (trimmed.startsWith('@')) return false;
    if (trimmed.startsWith('import') || trimmed.startsWith('package')) return true;
    if (trimmed.match(/\b(class|enum|interface|record)\b/)) return true;
    if (trimmed === '{' || trimmed === '}' || trimmed.endsWith('{') || trimmed.endsWith('}')) return false;
    if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) return false;
    if (trimmed.includes('(')) return true; // method-like line
    return false;
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!className) {
      const cm = trimmed.match(/\bclass\s+([A-Za-z_]\w*)/);
      if (cm) className = cm[1];
    }
    if (trimmed.startsWith('@')) {
      annBuf.push(trimmed);
      continue;
    }
    const m = line.match(fieldRe);
    if (m) {
      const type = m[3].trim();
      const name = m[4];
      const sn = simpleNameOf(type);
      const colM = annBuf.join(' ').match(columnRe);
      fields.push({
        name,
        type,
        column: colM ? colM[1] : name,
        simpleName: sn,
        relation: type.includes('<') || !SIMPLE_TYPES.has(sn),
        searchableString: sn === 'String',
        searchableExact: EXACT_TYPES.has(sn),
        dateType: DATE_TYPES.has(sn),
        label: labelOf(name),
      });
      annBuf = [];
      continue;
    }
    if (isBreakLine(trimmed)) annBuf = [];
  }
  return { className, fields };
}

/** Build a JPA Specification that ORs a contains-search over text columns and
 *  an exact-match over numeric/boolean columns. */
function generateSpecs(pkg, entityName, searchableFields) {
  const repoPkg = pkg + '.repository';
  const modelPkg = pkg + '.model';
  const cls = specsName(entityName);
  let hasBigDecimal = false;
  let hasBigInteger = false;
  for (const f of searchableFields) {
    if (f.simpleName === 'BigDecimal') hasBigDecimal = true;
    if (f.simpleName === 'BigInteger') hasBigInteger = true;
  }

  let s = '';
  s += 'package ' + repoPkg + ';\n\n';
  s += 'import ' + modelPkg + '.' + entityName + ';\n';
  s += 'import jakarta.persistence.criteria.CriteriaBuilder;\n';
  s += 'import jakarta.persistence.criteria.Predicate;\n';
  s += 'import jakarta.persistence.criteria.Root;\n';
  s += 'import org.springframework.data.jpa.domain.Specification;\n';
  s += 'import java.util.ArrayList;\n';
  s += 'import java.util.List;\n';
  if (hasBigDecimal) s += 'import java.math.BigDecimal;\n';
  if (hasBigInteger) s += 'import java.math.BigInteger;\n';
  s += '\npublic final class ' + cls + ' {\n';
  s += '    private ' + cls + '() {}\n\n';
  s += '    public static Specification<' + entityName + '> search(String q) {\n';
  s += '        return (root, query, cb) -> {\n';
  s += '            if (q == null || q.isBlank()) return null;\n';
  s += '            String like = "%" + q.toLowerCase() + "%";\n';
  s += '            List<Predicate> predicates = new ArrayList<>();\n';
  for (const f of searchableFields) {
    if (f.searchableString) {
      s += '            predicates.add(cb.like(cb.lower(root.get("' + f.name + '").as(String.class)), like));\n';
    } else if (f.searchableExact) {
      let expr;
      if (f.simpleName === 'BigDecimal') expr = 'new BigDecimal(q)';
      else if (f.simpleName === 'BigInteger') expr = 'new BigInteger(q)';
      else expr = f.simpleName + '.valueOf(q)';
      s += '            try { predicates.add(cb.equal(root.get("' + f.name + '"), ' + expr + ')); } catch (NumberFormatException ignore) {}\n';
    }
  }
  s += '            if (predicates.isEmpty()) return null;\n';
  s += '            return cb.or(predicates.toArray(new Predicate[0]));\n';
  s += '        };\n';
  s += '    }\n';
  s += '}\n';
  return s;
}

/** Build the Spring MVC (@Controller) endpoint that renders the Thymeleaf table. */
function generateController(pkg, entityName, columnFields) {
  const plural = pluralOf(entityName);
  const cls = controllerName(entityName);
  const ctrlPkg = pkg + '.controller.web';
  const modelPkg = pkg + '.model';
  const repoPkg = pkg + '.repository';
  const specsCls = specsName(entityName);
  const idField = columnFields.find((f) => f.name === 'id');
  const sortDefault = idField ? 'id' : (columnFields[0] ? columnFields[0].name : 'id');

  let s = '';
  s += 'package ' + ctrlPkg + ';\n\n';
  s += 'import ' + modelPkg + '.' + entityName + ';\n';
  s += 'import ' + repoPkg + '.' + entityName + 'Repository;\n';
  s += 'import ' + repoPkg + '.' + specsCls + ';\n';
  s += 'import org.springframework.data.domain.Page;\n';
  s += 'import org.springframework.data.domain.Pageable;\n';
  s += 'import org.springframework.data.domain.PageRequest;\n';
  s += 'import org.springframework.data.domain.Sort;\n';
  s += 'import org.springframework.data.jpa.domain.Specification;\n';
  s += 'import org.springframework.stereotype.Controller;\n';
  s += 'import org.springframework.ui.Model;\n';
  s += 'import org.springframework.web.bind.annotation.GetMapping;\n';
  s += 'import org.springframework.web.bind.annotation.RequestMapping;\n';
  s += 'import org.springframework.web.bind.annotation.RequestParam;\n\n';
  s += '@Controller\n';
  s += '@RequestMapping("/' + plural + '")\n';
  s += 'public class ' + cls + ' {\n\n';
  s += '    private final ' + entityName + 'Repository repository;\n\n';
  s += '    public ' + cls + '(' + entityName + 'Repository repository) { this.repository = repository; }\n\n';
  s += '    @GetMapping\n';
  s += '    public String list(Model model,\n';
  s += '            @RequestParam(defaultValue = "0") int page,\n';
  s += '            @RequestParam(defaultValue = "10") int size,\n';
  s += '            @RequestParam(defaultValue = "' + sortDefault + '") String sort,\n';
  s += '            @RequestParam(defaultValue = "asc") String dir,\n';
  s += '            @RequestParam(required = false) String search) {\n';
  s += '        Sort.Order order = "desc".equalsIgnoreCase(dir) ? Sort.Order.desc(sort) : Sort.Order.asc(sort);\n';
  s += '        Pageable pageable = PageRequest.of(page, size, Sort.by(order));\n';
  s += '        Specification<' + entityName + '> spec = (search == null || search.isBlank()) ? null : ' + specsCls + '.search(search);\n';
  s += '        Page<' + entityName + '> pageResult = repository.findAll(spec, pageable);\n';
  s += '        model.addAttribute("page", pageResult);\n';
  s += '        model.addAttribute("size", size);\n';
  s += '        model.addAttribute("search", search == null ? "" : search);\n';
  s += '        model.addAttribute("sort", sort);\n';
  s += '        model.addAttribute("dir", dir);\n';
  s += '        model.addAttribute("reverseDir", "asc".equalsIgnoreCase(dir) ? "desc" : "asc");\n';
  s += '        return "' + plural + '";\n';
  s += '    }\n';
  s += '}\n';
  return { cls, plural, content: s };
}

/** Build the Thymeleaf table page (Bootstrap 5, server-side pagination/search/sort). */
function generateTemplate(targetDir, plural, entityTitle, columnFields, dateFields) {
  const templatesDir = path.join(targetDir, 'src', 'main', 'resources', 'templates');
  fs.mkdirSync(templatesDir, { recursive: true });
  const dateSet = new Set(dateFields.map((f) => f.name));
  const colCount = columnFields.length + 1; // + actions column
  const lastPage = plural; // literal path used in th:href

  let html = '';
  html += '<!DOCTYPE html>\n';
  html += '<html xmlns:th="http://www.thymeleaf.org">\n';
  html += '<head>\n';
  html += '  <meta charset="UTF-8"/>\n';
  html += '  <meta name="viewport" content="width=device-width, initial-scale=1"/>\n';
  html += '  <title>' + entityTitle + '</title>\n';
  html += '  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet"/>\n';
  html += '  <link href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.css" rel="stylesheet"/>\n';
  html += '  <style>\n';
  html += '    .sorted { background: #e7f1ff !important; }\n';
  html += '    .text-small { font-size: 0.85rem; }\n';
  html += '  </style>\n';
  html += '</head>\n';
  html += '<body>\n';
  html += '<div class="container py-4">\n';
  html += '  <div class="d-flex flex-column flex-sm-row justify-content-between align-items-sm-start mb-4 gap-2">\n';
  html += '    <div>\n';
  html += '      <h2 class="mb-1"><i class="bi bi-table me-2"></i>' + entityTitle + '</h2>\n';
  html += '      <p class="text-muted mb-0">Paginated \u00b7 global search \u00b7 sortable table</p>\n';
  html += '    </div>\n';
  html += '    <a class="btn btn-primary d-none" href="#" title="Create form not generated yet">Add new <span class="visually-hidden">' + entityTitle + '</span></a>\n';
  html += '  </div>\n';

  // Search form
  html += '  <form method="get" action="" class="card p-3 mb-4 shadow-sm">\n';
  html += '    <input type="hidden" name="size" th:value="${size}"/>\n';
  html += '    <div class="input-group input-group-lg mb-2">\n';
  html += '      <span class="input-group-text"><i class="bi bi-search"></i></span>\n';
  html += '      <input name="search" class="form-control" placeholder="Search all columns\u2026" th:value="${search}"/>\n';
  html += '      <button class="btn btn-outline-secondary" type="submit">Search</button>\n';
  html += '      <a class="btn btn-outline-danger" th:href="@{/' + lastPage + '(page=0,size=${size},sort=${sort},dir=${dir})}">Clear</a>\n';
  html += '    </div>\n';
  html += '    <p class="text-small text-muted mb-0">Matches text columns (contains, case-insensitive) and exact-match on numbers/booleans.</p>\n';
  html += '  </form>\n';

  // Results info
  html += '  <div class="d-flex justify-content-between align-items-center mb-2">\n';
  html += '    <span class="text-muted">Showing <b th:text="${page.number * page.size + 1}">1</b> to <b th:text="${(page.number + 1) * page.size > page.totalElements ? page.totalElements : (page.number + 1) * page.size}">N</b> of <b th:text="${page.totalElements}">0</b> ' + entityTitle + '</span>\n';
  html += '    <span class="text-muted small">Page <b th:text="${page.number + 1}">1</b> of <b th:text="${page.totalPages}">1</b></span>\n';
  html += '  </div>\n';

  // Table
  html += '  <div class="card shadow-sm">\n';
  html += '    <div class="table-responsive">\n';
  html += '      <table class="table table-hover align-middle mb-0">\n';
  html += '        <thead class="table-light">\n';
  html += '          <tr>\n';
  for (const f of columnFields) {
    html += '            <th scope="col" class="cursor-pointer" style="user-select:none;" th:classappend="${sort == \'' + f.name + '\'} ? \'table-active\' : \'\'">\n';
    html += '              <a th:href="@{/' + lastPage + '(page=0,size=${size},sort=' + f.name + ',dir=${reverseDir},search=${search})}" class="text-reset text-decoration-none">\n';
    html += '                ' + f.label + '\n';
    html += '              </a>\n';
    html += '              <span th:if="${sort == \'' + f.name + '\'}" th:text="${dir == \'asc\'} ? \' \u25B2\' : \' \u25BC\'" class="ms-1"></span>\n';
    html += '            </th>\n';
  }
  html += '            <th scope="col" style="width:170px;">Actions</th>\n';
  html += '          </tr>\n';
  html += '        </thead>\n';
  html += '        <tbody>\n';
  html += '          <tr th:each="item : ${page.content}">\n';
  for (const f of columnFields) {
    if (dateSet.has(f.name)) {
      const fmt = f.simpleName === 'Date' ? '#dates.format' : '#temporals.format';
      const pat = f.simpleName === 'Date' ? 'yyyy-MM-dd' : 'yyyy-MM-dd HH:mm';
      html += '            <td th:text="${' + fmt + '(item.' + f.name + ', \'' + pat + '\')}">-</td>\n';
    } else {
      html += '            <td th:text="${item.' + f.name + '}">-</td>\n';
    }
  }
  html += '            <td class="text-end">\n';
  html += '              <a class="btn btn-sm btn-outline-secondary disabled" href="#" tabindex="-1" aria-disabled="true" title="Wire to GET /api/' + lastPage + '/{id}">View</a>\n';
  html += '              <a class="btn btn-sm btn-outline-secondary disabled" href="#" tabindex="-1" aria-disabled="true" title="Wire to an edit form">Edit</a>\n';
  html += '              <button class="btn btn-sm btn-outline-danger" onclick="app.del(\'/api/' + lastPage + '/\'+${item.id})">Delete</button>\n';
  html += '            </td>\n';
  html += '          </tr>\n';
  html += '          <tr th:if="${page.totalElements == 0}">\n';
  html += '            <td class="text-center text-muted py-4" th:attr="colspan=' + colCount + '">No records found.</td>\n';
  html += '          </tr>\n';
  html += '        </tbody>\n';
  html += '      </table>\n';
  html += '    </div>\n';
  html += '  </div>\n';

  // Pagination
  html += '  <nav aria-label="Page navigation" th:if="${page.totalPages > 0}">\n';
  html += '    <ul class="pagination justify-content-center mb-0">\n';
  html += '      <li class="page-item" th:class="${page.first} ? \'disabled\' : \'\'">\n';
  html += '        <a class="page-link" th:href="@{/' + lastPage + '(page=0,size=${size},sort=${sort},dir=${dir},search=${search})}">First</a>\n';
  html += '      </li>\n';
  html += '      <li class="page-item" th:class="${page.first} ? \'disabled\' : \'\'">\n';
  html += '        <a class="page-link" th:href="@{/' + lastPage + '(page=${page.number-1},size=${size},sort=${sort},dir=${dir},search=${search})}" aria-label="Previous">Previous</a>\n';
  html += '      </li>\n';
  html += '      <li class="page-item" th:each="i : ${#numbers.sequence(0, page.totalPages - 1)}" th:class="${page.number == i} ? \'active\' : \'\'">\n';
  html += '        <a class="page-link" th:href="@{/' + lastPage + '(page=${i},size=${size},sort=${sort},dir=${dir},search=${search})}" th:text="${i + 1}">1</a>\n';
  html += '      </li>\n';
  html += '      <li class="page-item" th:class="${page.last} ? \'disabled\' : \'\'">\n';
  html += '        <a class="page-link" th:href="@{/' + lastPage + '(page=${page.totalPages-1},size=${size},sort=${sort},dir=${dir},search=${search})}">Last</a>\n';
  html += '      </li>\n';
  html += '      <li class="page-item" th:class="${page.last} ? \'disabled\' : \'\'">\n';
  html += '        <a class="page-link" th:href="@{/' + lastPage + '(page=${page.number+1},size=${size},sort=${sort},dir=${dir},search=${search})}" aria-label="Next">Next</a>\n';
  html += '      </li>\n';
  html += '    </ul>\n';
  html += '  </nav>\n';

  // Delete via REST (CSRF is disabled in this template)
  html += '  <script>\n';
  html += '    (function(){window.app=window.app||{};window.app.del=function(url){if(!confirm(\'Delete this item?\'))return;fetch(url,{method:\'DELETE\'}).then(function(r){if(r.ok){location.reload();}else{alert(\'Delete failed (HTTP \'+r.status+\').\');}});};})();\n';
  html += '  </script>\n';
  html += '</div>\n';
  html += '</body>\n';
  html += '</html>\n';

  fs.writeFileSync(path.join(templatesDir, plural + '.html'), html, 'utf8');
}

/** Ensure the entity's repository extends JpaSpecificationExecutor so that
 *  repository.findAll(Specification, Pageable) compiles. Adds the import and
 *  amends the extends clause when missing (safe no-op if already present). */
function ensureSpecificationExecutor(repoPath, entityName) {
  if (!fs.existsSync(repoPath)) return;
  let content = fs.readFileSync(repoPath, 'utf8');
  if (content.includes('JpaSpecificationExecutor')) return;

  const jpaRepoImp = 'import org.springframework.data.jpa.repository.JpaRepository;';
  const specImp = 'import org.springframework.data.jpa.repository.JpaSpecificationExecutor;';
  if (content.includes(jpaRepoImp) && !content.includes(specImp)) {
    content = content.replace(jpaRepoImp + '\n', jpaRepoImp + '\n' + specImp + '\n');
  } else if (!content.includes(specImp)) {
    // insert spec import after the model import (best effort)
    const modelImp = 'import ' + (content.match(/import\s+([\w.]+\.model\.[A-Za-z_]\w*);/) && RegExp.$1 ? RegExp.$1 : '');
    if (modelImp) content = content.replace(modelImp + '\n', modelImp + '\n' + specImp + '\n');
  }

  content = content.replace(
    /extends\s+JpaRepository\s*<\s*([A-Za-z_]\w*)\s*,\s*([A-Za-z_]\w*)\s*>/g,
    'extends JpaRepository<$1, $2>, JpaSpecificationExecutor<$1>'
  );

  fs.writeFileSync(repoPath, content, 'utf8');
}

/** Scan every @Entity in the model package and generate a Thymeleaf listing for each. */
function generateThymeleafListings(targetDir) {  const packageName = detectPackage(targetDir);
  if (!packageName) {
    console.log('[THYMELEAF] Could not detect Java package; skipping entity listings.');
    return 0;
  }
  const pp = packageName.split('.');
  const modelDir = path.join(targetDir, 'src', 'main', 'java', ...pp, 'model');
  const repoDir = path.join(targetDir, 'src', 'main', 'java', ...pp, 'repository');
  const webCtrlDir = path.join(targetDir, 'src', 'main', 'java', ...pp, 'controller', 'web');
  const templatesDir = path.join(targetDir, 'src', 'main', 'resources', 'templates');

  if (!fs.existsSync(modelDir)) {
    console.log('[THYMELEAF] No model directory found; skipping entity listings.');
    return 0;
  }
  fs.mkdirSync(repoDir, { recursive: true });
  fs.mkdirSync(webCtrlDir, { recursive: true });
  fs.mkdirSync(templatesDir, { recursive: true });

  let count = 0;
  for (const file of fs.readdirSync(modelDir)) {
    if (!file.endsWith('.java')) continue;
    const content = fs.readFileSync(path.join(modelDir, file), 'utf8');
    if (!/@Entity/.test(content) && !/@jakarta\.persistence\.Entity/.test(content)) continue;
    const parsed = parseEntityFile(content);
    if (!parsed.className) continue;

    const entityName = parsed.className;
    const fields = parsed.fields;
    const columnFields = fields.filter((f) => !f.relation);
    const searchableFields = columnFields.filter((f) => f.searchableString || f.searchableExact);
    const dateFields = columnFields.filter((f) => f.dateType);

    // Ensure the repository supports JPA Specification queries
    ensureSpecificationExecutor(path.join(repoDir, entityName + 'Repository.java'), entityName);

    // JPA specification for global search
    fs.writeFileSync(path.join(repoDir, specsName(entityName) + '.java'), generateSpecs(packageName, entityName, searchableFields), 'utf8');

    // Spring MVC controller rendering the Thymeleaf page
    const ctrl = generateController(packageName, entityName, columnFields);
    fs.writeFileSync(path.join(webCtrlDir, ctrl.cls + '.java'), ctrl.content, 'utf8');

    // Thymeleaf table page
    generateTemplate(targetDir, ctrl.plural, toPascalCase(entityName) + ' List', columnFields, dateFields);

    count++;
    console.log('[THYMELEAF] ' + entityName + ' -> /' + ctrl.plural + ' (templates/' + ctrl.plural + '.html, ' + columnFields.length + ' column(s))');
  }
  console.log('[THYMELEAF] Generated ' + count + ' entity listing(s).');
  return count;
}

module.exports = { generateThymeleafListings, parseEntityFile };
