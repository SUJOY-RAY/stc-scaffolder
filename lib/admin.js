const fs = require('fs');
const path = require('path');
const { detectPackage } = require('./crud');
const { parseEntityFile } = require('./thymeleaf');
const { toPascalCase, toCamelCase } = require('./utils');

const SIMPLE_TYPES = new Set([
  'String', 'Integer', 'Long', 'int', 'long', 'Double', 'double', 'Float', 'float',
  'Boolean', 'boolean', 'Short', 'Byte', 'Character', 'char', 'BigDecimal', 'BigInteger',
  'Instant', 'LocalDateTime', 'LocalDate', 'LocalTime', 'OffsetDateTime', 'Date',
]);
const EXACT_TYPES = new Set([
  'Integer', 'Long', 'int', 'long', 'Double', 'double', 'Float', 'float', 'Short', 'Byte',
  'BigDecimal', 'BigInteger', 'Boolean', 'boolean',
]);
const DATE_TYPES = new Set(['Instant', 'LocalDateTime', 'LocalDate', 'LocalTime', 'OffsetDateTime', 'Date']);

function entityVar(name) { return toCamelCase(name); }
function pluralOf(name) { return entityVar(name) + 's'; }
function adminControllerName(name) { return toPascalCase(name) + 'AdminController'; }
function specsName(name) { return toPascalCase(name) + 'Specs'; }

function labelOf(name) {
  if (/^id$/i.test(name)) return 'ID';
  return name
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function simpleNameOf(type) {
  const t = type.trim().replace(/[<>\\[\],\s]+/g, ' ').trim().split(/\s+/).pop();
  return t.split('.').pop();
}

function isId(f) { return /^id$/i.test(f.name); }
function isFormField(f) { return !f.relation && !isId(f); }

/** Thymeleaf input type for a field. */
function inputTypeFor(f) {
  switch (f.simpleName) {
    case 'Integer': case 'Long': case 'int': case 'long': case 'Short': case 'Byte':
      return 'number';
    case 'Double': case 'Float': case 'double': case 'float': case 'BigDecimal': case 'BigInteger':
      return 'number';
    case 'Boolean': case 'boolean':
      return 'select';
    case 'Instant': case 'LocalDateTime':
      return 'datetime-local';
    case 'LocalDate': case 'Date':
      return 'date';
    default:
      return 'text';
  }
}

/** Whether the field is rendered as a <select> true/false. */
function isBooleanSelect(f) { return f.simpleName === 'Boolean' || f.simpleName === 'boolean'; }
/** Whether the field is rendered as a date/time input. */
function isDateInput(f) { return f.dateType; }
/** Whether the field is rendered as a numeric input. */
function isNumberInput(f) {
  return ['Integer', 'Long', 'int', 'long', 'Short', 'Byte', 'Double', 'Float', 'double', 'float', 'BigDecimal', 'BigInteger'].includes(f.simpleName);
}

/** Value expression used in th:value for the field in the list/view templates. */
function valueExpr(f, prefix) {
  const p = prefix || 'item';
  if (f.dateType) {
    const fmt = f.simpleName === 'Date' ? '#dates.format' : '#temporals.format';
    const pat = f.simpleName === 'Date' ? 'yyyy-MM-dd' : 'yyyy-MM-dd\'T\'HH:mm:ss';
    return '${' + fmt + '(' + p + '.' + f.name + ', \'' + pat + '\')}';
  }
  return '${' + p + '.' + f.name + '}';
}

/** A safe Java literal default / parse snippet for a field from a String param. */
function parseSnippet(f, paramName) {
  const sn = f.simpleName;
  if (sn === 'String') return paramName;
  if (sn === 'Boolean' || sn === 'boolean') return paramName + " != null ? Boolean.valueOf(" + paramName + ") : null";
  if (sn === 'Integer' || sn === 'int') return paramName + " != null && !" + paramName + ".isBlank() ? Integer.valueOf(" + paramName + ") : null";
  if (sn === 'Long' || sn === 'long') return paramName + " != null && !" + paramName + ".isBlank() ? Long.valueOf(" + paramName + ") : null";
  if (sn === 'Short' || sn === 'byte' || sn === 'Byte') return paramName + " != null && !" + paramName + ".isBlank() ? Short.valueOf(" + paramName + ") : null";
  if (sn === 'Double' || sn === 'double') return paramName + " != null && !" + paramName + ".isBlank() ? Double.valueOf(" + paramName + ") : null";
  if (sn === 'Float' || sn === 'float') return paramName + " != null && !" + paramName + ".isBlank() ? Float.valueOf(" + paramName + ") : null";
  if (sn === 'BigDecimal') return paramName + " != null && !" + paramName + ".isBlank() ? new java.math.BigDecimal(" + paramName + ") : null";
  if (sn === 'BigInteger') return paramName + " != null && !" + paramName + ".isBlank() ? new java.math.BigInteger(" + paramName + ") : null";
  if (sn === 'Instant') return paramName + " != null && !" + paramName + ".isBlank() ? java.time.Instant.parse(" + paramName + ") : null";
  if (sn === 'LocalDateTime') return paramName + " != null && !" + paramName + ".isBlank() ? java.time.LocalDateTime.parse(" + paramName + ") : null";
  if (sn === 'LocalDate') return paramName + " != null && !" + paramName + ".isBlank() ? java.time.LocalDate.parse(" + paramName + ") : null";
  if (sn === 'LocalTime') return paramName + " != null && !" + paramName + ".isBlank() ? java.time.LocalTime.parse(" + paramName + ") : null";
  if (sn === 'OffsetDateTime') return paramName + " != null && !" + paramName + ".isBlank() ? java.time.OffsetDateTime.parse(" + paramName + ") : null";
  if (sn === 'Date') return paramName + " != null && !" + paramName + ".isBlank() ? java.util.Date.from(java.time.Instant.parse(" + paramName + ")) : null";
  return paramName;
}

/** Ensure the repository extends JpaSpecificationExecutor. */
function ensureSpecificationExecutor(repoPath, entityName) {
  if (!fs.existsSync(repoPath)) return;
  let content = fs.readFileSync(repoPath, 'utf8');
  if (content.includes('JpaSpecificationExecutor')) return;

  const jpaRepoImp = 'import org.springframework.data.jpa.repository.JpaRepository;';
  const specImp = 'import org.springframework.data.jpa.repository.JpaSpecificationExecutor;';
  if (content.includes(jpaRepoImp) && !content.includes(specImp)) {
    content = content.replace(jpaRepoImp + '\n', jpaRepoImp + '\n' + specImp + '\n');
  }

  content = content.replace(
    /extends\s+JpaRepository\s*<\s*([A-Za-z_]\w*)\s*,\s*([A-Za-z_]\w*)\s*>/g,
    'extends JpaRepository<$1, $2>, JpaSpecificationExecutor<$1>'
  );

  fs.writeFileSync(repoPath, content, 'utf8');
}

/** Generate the /db dashboard controller listing all entities. */
function generateDbController(pkg, entities) {
  const ctrlPkg = pkg + '.controller.web';
  const cls = 'DbController';
  const ctrlDir = path.join('src', 'main', 'java', ...pkg.split('.'), 'controller', 'web');
  // entities: [{name, plural, columns}]
  let entries = '';

  let s = '';
  s += 'package ' + ctrlPkg + ';\n\n';
  s += 'import org.springframework.stereotype.Controller;\n';
  s += 'import org.springframework.ui.Model;\n';
  s += 'import org.springframework.web.bind.annotation.GetMapping;\n';
  s += 'import org.springframework.web.bind.annotation.RequestMapping;\n';
  s += 'import org.springframework.security.access.prepost.PreAuthorize;\n';
  s += 'import java.util.ArrayList;\n';
  s += 'import java.util.HashMap;\n';
  s += 'import java.util.List;\n';
  s += 'import java.util.Map;\n\n';
  s += '@Controller\n';
  s += '@RequestMapping("/db")\n';
  s += '@PreAuthorize("hasRole(\'ADMIN\')")\n';
  s += 'public class ' + cls + ' {\n\n';
  s += '    @GetMapping\n';
  s += '    public String index(Model model) {\n';
  s += '        List<Map<String, String>> entities = new ArrayList<>();\n';
  for (const e of entities) {
    s += '        Map<String, String> e_' + e.name.toLowerCase() + ' = new HashMap<>();\n';
    s += '        e_' + e.name.toLowerCase() + '.put("name", "' + e.name + '");\n';
    s += '        e_' + e.name.toLowerCase() + '.put("plural", "' + e.plural + '");\n';
    s += '        e_' + e.name.toLowerCase() + '.put("url", "/db/' + e.plural + '");\n';
    s += '        e_' + e.name.toLowerCase() + '.put("columns", "' + e.columns + '");\n';
    s += '        entities.add(e_' + e.name.toLowerCase() + ');\n';
  }
  s += '        model.addAttribute("entities", entities);\n';
  s += '        return "db";\n';
  s += '    }\n';
  s += '}\n';
  return { cls, content: s };
}

/** Generate the dashboard Thymeleaf page. */
function generateDashboardTemplate(targetDir, entities) {
  const templatesDir = path.join(targetDir, 'src', 'main', 'resources', 'templates');
  fs.mkdirSync(templatesDir, { recursive: true });
  let rows = '';
  for (const e of entities) {
    rows += '      <div class="col">\n';
    rows += '        <div class="card h-100 shadow-sm">\n';
    rows += '          <div class="card-body d-flex flex-column">\n';
    rows += '            <h5 class="card-title">' + e.name + '</h5>\n';
    rows += '            <p class="card-text text-muted small flex-fill">' + e.columns + ' column(s)</p>\n';
    rows += '            <a href="/db/' + e.plural + '" class="btn btn-outline-primary mt-auto">Open ' + e.name + '</a>\n';
    rows += '          </div>\n';
    rows += '        </div>\n';
    rows += '      </div>\n';
  }

  let html = '';
  html += '<!DOCTYPE html>\n';
  html += '<html xmlns:th="http://www.thymeleaf.org">\n';
  html += '<head>\n';
  html += '  <meta charset="UTF-8"/>\n';
  html += '  <meta name="viewport" content="width=device-width, initial-scale=1"/>\n';
  html += '  <title>Database Admin</title>\n';
  html += '  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet"/>\n';
  html += '  <link href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.css" rel="stylesheet"/>\n';
  html += '</head>\n';
  html += '<body>\n';
  html += '<div class="container py-4">\n';
  html += '  <div class="d-flex justify-content-between align-items-center mb-4">\n';
  html += '    <h2><i class="bi bi-database me-2"></i>Database Admin</h2>\n';
  html += '    <a class="btn btn-secondary" href="/">Back to home</a>\n';
  html += '  </div>\n';
  html += '  <p class="text-muted mb-4">Browse and manage your JPA entities (Django-style admin).</p>\n';
  html += '  <div class="row row-cols-1 row-cols-sm-2 row-cols-md-3 row-cols-lg-4 g-4">\n';
  html += rows;
  html += '  </div>\n';
  html += '</div>\n';
  html += '</body>\n';
  html += '</html>\n';
  fs.writeFileSync(path.join(templatesDir, 'db.html'), html, 'utf8');
}

/** Generate the admin controller for one entity with full CRUD. */
function generateAdminController(pkg, entityName, fields) {
  const plural = pluralOf(entityName);
  const entityVarL = entityVar(entityName);
  const modelPkg = pkg + '.model';
  const repoPkg = pkg + '.repository';
  const specsCls = specsName(entityName);
  const ctrlPkg = pkg + '.controller.web';
  const cls = adminControllerName(entityName);
  const idField = fields.find((f) => isId(f));
  const sortDefault = idField ? 'id' : (fields[0] ? fields[0].name : 'id');
  const idType = idField ? idField.simpleName : 'Long';
  const formFields = fields.filter(isFormField);

  // Build @RequestParam declarations for create/update
  let createParams = '';
  let createAssigns = '';
  let updateParams = '';
  let updateAssigns = '';
  for (const f of formFields) {
    const pname = f.name;
    const cap = pname.charAt(0).toUpperCase() + pname.slice(1);
    const setter = 'entity.set' + cap + '(';
    createParams += '    @RequestParam(required = false) String ' + pname + ',\n';
    createAssigns += '        if (' + pname + ' != null && !' + pname + ".isBlank()" + ') ' + setter + parseSnippet(f, pname) + ');\n';
    updateParams += '    @RequestParam(required = false) String ' + pname + ',\n';
    updateAssigns += '        if (' + pname + ' != null && !' + pname + ".isBlank()" + ') ' + setter + parseSnippet(f, pname) + ');\n';
  }
  // createParams / updateParams already end with ",\n" per line, so the method
  // signature is valid whether or not there are form fields.

  let needsDateTimeFormat = false;
  let needsInstant = false;
  for (const f of formFields) {
    if (f.dateType) needsDateTimeFormat = true;
    if (f.simpleName === 'Instant') needsInstant = true;
  }

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
  s += 'import org.springframework.web.bind.annotation.*;\n';
  s += 'import org.springframework.web.servlet.mvc.support.RedirectAttributes;\n';
  s += 'import org.springframework.security.access.prepost.PreAuthorize;\n';
  s += 'import java.util.Optional;\n';
  if (needsDateTimeFormat) {
    s += 'import org.springframework.format.annotation.DateTimeFormat;\n';
    s += 'import java.time.format.DateTimeFormatter;\n';
  }
  s += '\n@Controller\n';
  s += '@RequestMapping("/db/' + plural + '")\n';
  s += '@PreAuthorize("hasRole(\'ADMIN\')")\n';
  s += 'public class ' + cls + ' {\n\n';
  s += '    private final ' + entityName + 'Repository repository;\n\n';
  s += '    public ' + cls + '(' + entityName + 'Repository repository) { this.repository = repository; }\n\n';

  // LIST
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
  s += '    }\n\n';

  // NEW FORM
  s += '    @GetMapping("/new")\n';
  s += '    public String createForm(Model model) {\n';
  s += '        model.addAttribute("' + entityVarL + '", new ' + entityName + '());\n';
  s += '        return "' + plural + '-form";\n';
  s += '    }\n\n';

  // CREATE
  s += '    @PostMapping\n';
  s += '    public String create(Model model,\n' + createParams + '        RedirectAttributes ra) {\n';
  s += '        ' + entityName + ' entity = new ' + entityName + '();\n';
  s += createAssigns;
  s += '        repository.save(entity);\n';
  s += '        ra.addFlashAttribute("message", "' + entityName + ' created.");\n';
  s += '        return "redirect:/db/' + plural + '";\n';
  s += '    }\n\n';

  // VIEW
  s += '    @GetMapping("/{id}")\n';
  s += '    public String view(@PathVariable ' + idType + ' id, Model model) {\n';
  s += '        ' + entityName + ' entity = repository.findById(id)\n';
  s += '                .orElseThrow(() -> new RuntimeException("' + entityName + ' not found with id: " + id));\n';
  s += '        model.addAttribute("' + entityVarL + '", entity);\n';
  s += '        return "' + plural + '-view";\n';
  s += '    }\n\n';

  // EDIT FORM
  s += '    @GetMapping("/{id}/edit")\n';
  s += '    public String editForm(@PathVariable ' + idType + ' id, Model model) {\n';
  s += '        ' + entityName + ' entity = repository.findById(id)\n';
  s += '                .orElseThrow(() -> new RuntimeException("' + entityName + ' not found with id: " + id));\n';
  s += '        model.addAttribute("' + entityVarL + '", entity);\n';
  s += '        return "' + plural + '-form";\n';
  s += '    }\n\n';

  // UPDATE
  s += '    @PostMapping("/{id}")\n';
  s += '    public String update(@PathVariable ' + idType + ' id,\n' + updateParams + '        RedirectAttributes ra) {\n';
  s += '        ' + entityName + ' entity = repository.findById(id)\n';
  s += '                .orElseThrow(() -> new RuntimeException("' + entityName + ' not found with id: " + id));\n';
  s += updateAssigns;
  s += '        repository.save(entity);\n';
  s += '        ra.addFlashAttribute("message", "' + entityName + ' updated.");\n';
  s += '        return "redirect:/db/' + plural + '";\n';
  s += '    }\n\n';

  // DELETE
  s += '    @PostMapping("/{id}/delete")\n';
  s += '    public String delete(@PathVariable ' + idType + ' id, RedirectAttributes ra) {\n';
  s += '        if (repository.existsById(id)) repository.deleteById(id);\n';
  s += '        ra.addFlashAttribute("message", "' + entityName + ' deleted.");\n';
  s += '        return "redirect:/db/' + plural + '";\n';
  s += '    }\n';
  s += '}\n';
  return { cls, plural, content: s };
}

/** Generate the list CRUD page (table) at /db/<plural>. */
function generateListTemplate(targetDir, plural, entityTitle, fields) {
  const templatesDir = path.join(targetDir, 'src', 'main', 'resources', 'templates');
  fs.mkdirSync(templatesDir, { recursive: true });
  const dateSet = new Set(fields.filter((f) => f.dateType).map((f) => f.name));
  const colCount = fields.length + 1;
  const idField = fields.find((f) => isId(f));
  const hasId = !!idField;

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
  html += '      <p class="text-muted mb-0">Paginated \u00b7 global search \u00b7 sortable table \u00b7 full CRUD</p>\n';
  html += '    </div>\n';
  html += '    <a class="btn btn-primary" th:href="@{/' + plural + '/new}"><i class="bi bi-plus-lg me-2"></i>Add new <span class="visually-hidden">' + entityTitle + '</span></a>\n';
  html += '    <a class="btn btn-outline-secondary" th:href="@{/db}"><i class="bi bi-arrow-left me-2"></i>Back to tables</a>\n';
  html += '  </div>\n';

  // flash message
  html += '  <div th:if="${message}" class="alert alert-success alert-dismissible fade show" role="alert" th:text="${message}">Created.</div>\n';
  html += '  <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>\n';
  html += '  </div>\n';

  // Search form
  html += '  <form method="get" action="" class="card p-3 mb-4 shadow-sm">\n';
  html += '    <input type="hidden" name="size" th:value="${size}"/>\n';
  html += '    <div class="input-group input-group-lg mb-2">\n';
  html += '      <span class="input-group-text"><i class="bi bi-search"></i></span>\n';
  html += '      <input name="search" class="form-control" placeholder="Search all columns\u2026" th:value="${search}"/>\n';
  html += '      <button class="btn btn-outline-secondary" type="submit">Search</button>\n';
  html += '      <a class="btn btn-outline-danger" th:href="@{/' + plural + '(page=0,size=${size},sort=${sort},dir=${dir})}">Clear</a>\n';
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
  for (const f of fields) {
    html += '            <th scope="col" class="cursor-pointer" style="user-select:none;" th:classappend="${sort == \'' + f.name + '\'} ? \'table-active\' : \'\'">\n';
    html += '              <a th:href="@{/' + plural + '(page=0,size=${size},sort=' + f.name + ',dir=${reverseDir},search=${search})}" class="text-reset text-decoration-none">\n';
    html += '                ' + f.label + '\n';
    html += '              </a>\n';
    html += '              <span th:if="${sort == \'' + f.name + '\'}" th:text="${dir == \'asc\'} ? \' \u25B2\' : \' \u25BC\'" class="ms-1"></span>\n';
    html += '            </th>\n';
  }
  html += '            <th scope="col" style="width:220px;">Actions</th>\n';
  html += '          </tr>\n';
  html += '        </thead>\n';
  html += '        <tbody>\n';
  html += '          <tr th:each="item : ${page.content}">\n';
  for (const f of fields) {
    if (dateSet.has(f.name)) {
      const fmt = f.simpleName === 'Date' ? '#dates.format' : '#temporals.format';
      const pat = f.simpleName === 'Date' ? 'yyyy-MM-dd' : 'yyyy-MM-dd HH:mm';
      html += '            <td th:text="${' + fmt + '(item.' + f.name + ', \'' + pat + '\')}">-</td>\n';
    } else {
      html += '            <td th:text="${item.' + f.name + '}">-</td>\n';
    }
  }
  html += '            <td class="text-end">\n';
  html += '              <a class="btn btn-sm btn-outline-primary" th:href="@{/db/' + plural + '/{id}(id=${item.id})}"><i class="bi bi-eye"></i></a>\n';
  html += '              <a class="btn btn-sm btn-outline-secondary" th:href="@{/db/' + plural + '/{id}/edit(id=${item.id})}"><i class="bi bi-pencil-square"></i></a>\n';
  html += '              <form th:action="@{/db/' + plural + '/{id}/delete(id=${item.id})}" method="post" style="display:inline;" onsubmit="return confirm(\'Delete this item?\');">\n';
  html += '                <button class="btn btn-sm btn-outline-danger" type="submit"><i class="bi bi-trash"></i></button>\n';
  html += '              </form>\n';
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
  html += '        <a class="page-link" th:href="@{/' + plural + '(page=0,size=${size},sort=${sort},dir=${dir},search=${search})}">First</a>\n';
  html += '      </li>\n';
  html += '      <li class="page-item" th:class="${page.first} ? \'disabled\' : \'\'">\n';
  html += '        <a class="page-link" th:href="@{/' + plural + '(page=${page.number-1},size=${size},sort=${sort},dir=${dir},search=${search})}" aria-label="Previous">Previous</a>\n';
  html += '      </li>\n';
  html += '      <li class="page-item" th:each="i : ${#numbers.sequence(0, page.totalPages - 1)}" th:class="${page.number == i} ? \'active\' : \'\'">\n';
  html += '        <a class="page-link" th:href="@{/' + plural + '(page=${i},size=${size},sort=${sort},dir=${dir},search=${search})}" th:text="${i + 1}">1</a>\n';
  html += '      </li>\n';
  html += '      <li class="page-item" th:class="${page.last} ? \'disabled\' : \'\'">\n';
  html += '        <a class="page-link" th:href="@{/' + plural + '(page=${page.totalPages-1},size=${size},sort=${sort},dir=${dir},search=${search})}">Last</a>\n';
  html += '      </li>\n';
  html += '      <li class="page-item" th:class="${page.last} ? \'disabled\' : \'\'">\n';
  html += '        <a class="page-link" th:href="@{/' + plural + '(page=${page.number+1},size=${size},sort=${sort},dir=${dir},search=${search})}" aria-label="Next">Next</a>\n';
  html += '      </li>\n';
  html += '    </ul>\n';
  html += '  </nav>\n';
  html += '</div>\n';
  html += '</body>\n';
  html += '</html>\n';
  fs.writeFileSync(path.join(templatesDir, plural + '.html'), html, 'utf8');
}

/** Generate the create/edit form page. */
function generateFormTemplate(targetDir, plural, entityTitle, fields, isEdit) {
  const templatesDir = path.join(targetDir, 'src', 'main', 'resources', 'templates');
  fs.mkdirSync(templatesDir, { recursive: true });
  const formFields = fields.filter(isFormField);
  const editAction = 'th:action="@{/db/' + plural + '/{id}(id=${' + entityVarName(entityTitle) + '.id})}" method="post"';
  const createAction = 'th:action="@{/db/' + plural + '}" method="post"';
  const action = isEdit ? editAction : createAction;
  const submitLabel = isEdit ? 'Update' : 'Create';

  let formGroups = '';
  for (const f of formFields) {
    const label = f.label;
    const required = f.name === 'username' || f.name === 'email' ? ' required' : '';
    const inputType = inputTypeFor(f);
    const name = f.name;
    const step = isNumberInput(f) ? ' step="any"' : '';
    const min = isNumberInput(f) ? ' min="0"' : '';
    let valueExprStr;
    if (f.dateType) {
      const fmt = f.simpleName === 'Date' ? '#dates.format' : '#temporals.format';
      const pat = f.simpleName === 'Date' ? 'yyyy-MM-dd' : 'yyyy-MM-dd\'T\'HH:mm:ss';
      valueExprStr = '${' + fmt + '(' + entityVarName(entityTitle) + '.' + f.name + ', \'' + pat + '\')}';
    } else {
      valueExprStr = '${' + entityVarName(entityTitle) + '.' + f.name + '}';
    }

    formGroups += '    <div class="mb-3">\n';
    formGroups += '      <label class="form-label">' + label + '</label>\n';
    if (isBooleanSelect(f)) {
      formGroups += '      <select name="' + name + '" class="form-select"' + required + '>\n';
      formGroups += '        <option value="true" th:selected="${' + entityVarName(entityTitle) + '.' + f.name + ' == true}">true</option>\n';
      formGroups += '        <option value="false" th:selected="${' + entityVarName(entityTitle) + '.' + f.name + ' == false}">false</option>\n';
      formGroups += '      </select>\n';
    } else if (isDateInput(f)) {
      formGroups += '      <input type="' + inputType + '" name="' + name + '" class="form-control"' + step + min + required + '\n';
      formGroups += '            th:value="' + valueExprStr + '" />\n';
    } else {
      formGroups += '      <input type="' + inputType + '" name="' + name + '" class="form-control"' + step + min + required + '\n';
      formGroups += '            th:value="' + valueExprStr + '" />\n';
    }
    formGroups += '    </div>\n';
  }

  let html = '';
  html += '<!DOCTYPE html>\n';
  html += '<html xmlns:th="http://www.thymeleaf.org">\n';
  html += '<head>\n';
  html += '  <meta charset="UTF-8"/>\n';
  html += '  <meta name="viewport" content="width=device-width, initial-scale=1"/>\n';
  html += '  <title>' + (isEdit ? 'Edit ' : 'Add ') + entityTitle + '</title>\n';
  html += '  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet"/>\n';
  html += '  <link href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.css" rel="stylesheet"/>\n';
  html += '</head>\n';
  html += '<body>\n';
  html += '<div class="container py-4">\n';
  html += '  <div class="d-flex justify-content-between align-items-center mb-4">\n';
  html += '    <h2><i class="bi bi-' + (isEdit ? 'pencil-square' : 'plus-lg') + ' me-2"></i>' + (isEdit ? 'Edit ' : 'Add ') + entityTitle + '</h2>\n';
  html += '    <a class="btn btn-outline-secondary" th:href="@{/db/' + plural + '}">Back to list</a>\n';
  html += '  </div>\n';
  html += '  <div class="row justify-content-center">\n';
  html += '    <div class="col-md-8 col-lg-6">\n';
  html += '      <div class="card shadow-sm">\n';
  html += '        <div class="card-body">\n';
  html += '          <form ' + action + '>\n';
  html += formGroups;
  html += '          <div class="d-flex gap-2 mt-4">\n';
  html += '            <button class="btn btn-primary" type="submit"><i class="bi bi-check-lg me-2"></i>' + submitLabel + '</button>\n';
  html += '            <a class="btn btn-outline-secondary" th:href="@{/db/\'' + plural + '\'}">Cancel</a>\n';
  html += '          </div>\n';
  html += '          </form>\n';
  html += '        </div>\n';
  html += '      </div>\n';
  html += '    </div>\n';
  html += '  </div>\n';
  html += '</div>\n';
  html += '</body>\n';
  html += '</html>\n';
  fs.writeFileSync(path.join(templatesDir, plural + '-form.html'), html, 'utf8');
}

function entityVarName(entityTitle) {
  // camelCase of title e.g. "User" -> "user", "Product" -> "product"
  return entityTitle.charAt(0).toLowerCase() + entityTitle.slice(1);
}

/** Generate the detail/view page. */
function generateViewTemplate(targetDir, plural, entityTitle, fields) {
  const templatesDir = path.join(targetDir, 'src', 'main', 'resources', 'templates');
  fs.mkdirSync(templatesDir, { recursive: true });
  const dateSet = new Set(fields.filter((f) => f.dateType).map((f) => f.name));
  const ev = entityVarName(entityTitle);

  let rows = '';
  for (const f of fields) {
    if (isId(f)) continue; // id shown separately as badge
    let cell;
    if (dateSet.has(f.name)) {
      const fmt = f.simpleName === 'Date' ? '#dates.format' : '#temporals.format';
      const pat = f.simpleName === 'Date' ? 'yyyy-MM-dd' : 'yyyy-MM-dd HH:mm';
      cell = '${' + fmt + '(' + ev + '.' + f.name + ', \'' + pat + '\')}';
    } else {
      cell = '${' + ev + '.' + f.name + '}';
    }
    rows += '          <tr>\n';
    rows += '            <th class="w-25" style="color:#6c757d;">' + f.label + '</th>\n';
    rows += '            <td th:text="' + cell + '">-</td>\n';
    rows += '          </tr>\n';
  }

  let html = '';
  html += '<!DOCTYPE html>\n';
  html += '<html xmlns:th="http://www.thymeleaf.org">\n';
  html += '<head>\n';
  html += '  <meta charset="UTF-8"/>\n';
  html += '  <meta name="viewport" content="width=device-width, initial-scale=1"/>\n';
  html += '  <title>' + entityTitle + ' #</title>\n';
  html += '  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet"/>\n';
  html += '  <link href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.css" rel="stylesheet"/>\n';
  html += '</head>\n';
  html += '<body>\n';
  html += '<div class="container py-4">\n';
  html += '  <div class="d-flex justify-content-between align-items-center mb-4">\n';
  html += '    <h2><i class="bi bi-eye me-2"></i>' + entityTitle + ' <span class="badge bg-secondary" th:text="${' + ev + '.id}">1</span></h2>\n';
  html += '    <div>\n';
  html += '      <a class="btn btn-outline-secondary" th:href="@{/db/\'' + plural + '\'/{id}/edit(id=' + ev + '.id)}"><i class="bi bi-pencil-square me-2"></i>Edit</a>\n';
  html += '      <form th:action="@{/db/\'' + plural + '\'/{id}/delete(id=' + ev + '.id)}" method="post" style="display:inline;" onsubmit="return confirm(\'Delete this item?\');">\n';
  html += '        <button class="btn btn-outline-danger" type="submit"><i class="bi bi-trash me-2"></i>Delete</button>\n';
  html += '      </form>\n';
  html += '      <a class="btn btn-outline-secondary" th:href="@{/db/\'' + plural + '\'}"><i class="bi bi-arrow-left me-2"></i>Back to list</a>\n';
  html += '    </div>\n';
  html += '  </div>\n';
  html += '  <div class="card shadow-sm">\n';
  html += '    <div class="card-body">\n';
  html += '      <table class="table table-borderless">\n';
  html += rows;
  html += '      </table>\n';
  html += '    </div>\n';
  html += '  </div>\n';
  html += '</div>\n';
  html += '</body>\n';
  html += '</html>\n';
  fs.writeFileSync(path.join(templatesDir, plural + '-view.html'), html, 'utf8');
}

/** Scan every @Entity and generate the full Django-like admin under /db. */
function generateAdmin(targetDir) {
  const packageName = detectPackage(targetDir);
  if (!packageName) {
    console.log('[ADMIN] Could not detect Java package; skipping admin generation.');
    return 0;
  }
  const pp = packageName.split('.');
  const modelDir = path.join(targetDir, 'src', 'main', 'java', ...pp, 'model');
  const repoDir = path.join(targetDir, 'src', 'main', 'java', ...pp, 'repository');
  const webCtrlDir = path.join(targetDir, 'src', 'main', 'java', ...pp, 'controller', 'web');
  const templatesDir = path.join(targetDir, 'src', 'main', 'resources', 'templates');

  if (!fs.existsSync(modelDir)) {
    console.log('[ADMIN] No model directory found; skipping admin generation.');
    return 0;
  }
  fs.mkdirSync(repoDir, { recursive: true });
  fs.mkdirSync(webCtrlDir, { recursive: true });
  fs.mkdirSync(templatesDir, { recursive: true });

  const entities = [];
  for (const file of fs.readdirSync(modelDir)) {
    if (!file.endsWith('.java')) continue;
    const content = fs.readFileSync(path.join(modelDir, file), 'utf8');
    if (!/@Entity/.test(content) && !/@jakarta\.persistence\.Entity/.test(content)) continue;
    const parsed = parseEntityFile(content);
    if (!parsed.className) continue;

    const entityName = parsed.className;
    const fields = parsed.fields;
    const columnFields = fields.filter((f) => !f.relation);
    const plural = pluralOf(entityName);
    const entityTitle = toPascalCase(entityName);

    // Ensure repository supports Specification queries
    ensureSpecificationExecutor(path.join(repoDir, entityName + 'Repository.java'), entityName);

    // JPA specification for global search
    const searchableFields = columnFields.filter((f) => f.searchableString || f.searchableExact);
    const specsContent = generateSpecsContent(packageName, entityName, searchableFields);
    fs.writeFileSync(path.join(repoDir, specsName(entityName) + '.java'), specsContent, 'utf8');

    // Admin controller with full CRUD
    const ctrl = generateAdminController(packageName, entityName, columnFields);
    fs.writeFileSync(path.join(webCtrlDir, ctrl.cls + '.java'), ctrl.content, 'utf8');

    // Templates: list, form (create/edit), view
    generateListTemplate(targetDir, plural, entityTitle, columnFields);
    generateFormTemplate(targetDir, plural, entityTitle, columnFields, false);
    generateFormTemplate(targetDir, plural, entityTitle, columnFields, true);
    generateViewTemplate(targetDir, plural, entityTitle, columnFields);

    entities.push({ name: entityName, plural: plural, columns: columnFields.length });
    console.log('[ADMIN] ' + entityName + ' -> /db/' + plural + ' (' + columnFields.length + ' column(s))');
  }

  // Dashboard controller + template
  if (entities.length > 0) {
    const dbCtrl = generateDbController(packageName, entities);
    fs.writeFileSync(path.join(webCtrlDir, dbCtrl.cls + '.java'), dbCtrl.content, 'utf8');
    generateDashboardTemplate(targetDir, entities);
    console.log('[ADMIN] Dashboard -> /db (' + entities.length + ' table(s))');
  }

  console.log('[ADMIN] Generated ' + entities.length + ' admin section(s).');
  return entities.length;
}

/** Generate JPA Specification search content (inline, no external dep). */
function generateSpecsContent(pkg, entityName, searchableFields) {
  const repoPkg = pkg + '.repository';
  const modelPkg = pkg + '.model';
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
  s += '\npublic final class ' + specsName(entityName) + ' {\n';
  s += '    private ' + specsName(entityName) + '() {}\n\n';
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

module.exports = { generateAdmin, parseEntityFile, inputTypeFor };
