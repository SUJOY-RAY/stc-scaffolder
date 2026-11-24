const fs = require('fs');
const path = require('path');
const { javaType, toCamelCase } = require('./utils');

/** Collect all files under a directory recursively (returns array of paths). */
function walkSyncFiles(dir) {
  let results = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) results = results.concat(walkSyncFiles(p));
    else results.push(p);
  }
  return results;
}

/** Detect the Java package name by reading package declarations from all .java files
 *  and computing their common root prefix. */
function detectPackage(targetDir) {
  const javaSrc = path.join(targetDir, 'src', 'main', 'java');
  if (!fs.existsSync(javaSrc)) return null;
  const pkgs = new Set();
  walkSyncFiles(javaSrc).forEach(f => {
    if (!f.endsWith('.java')) return;
    const content = fs.readFileSync(f, 'utf8');
    const m = content.match(/^package\s+([\w.]+);/m);
    if (m) pkgs.add(m[1]);
  });
  if (pkgs.size === 0) return null;
  const arr = [...pkgs].map(p => p.split('.'));
  // Find longest common prefix by segments
  let common = arr[0];
  for (let i = 1; i < arr.length; i++) {
    let j = 0;
    while (j < common.length && j < arr[i].length && common[j] === arr[i][j]) j++;
    common = common.slice(0, j);
    if (common.length === 0) break;
  }
  return common.length > 0 ? common.join('.') : null;
}

/** Generate CRUD (Controller + Service + DTOs) for a given entity based on its fields.
 *  Works both at bootstrap time and later on an already-generated project.
 */
function generateCrudForEntity(targetDir, entityName, fields) {
  const packageName = detectPackage(targetDir);
  if (!packageName) {
    console.error('[CRUD] Could not detect Java package from existing sources.');
    return;
  }
  const entityVar = entityName.charAt(0).toLowerCase() + entityName.slice(1);
  const modelPkg = packageName + '.model';
  const repoPkg = packageName + '.repository';
  const servicePkg = packageName + '.service';
  const dtoPkg = packageName + '.dto';
  const ctrlPkg = packageName + '.controller';

  const pp = packageName.split('.');
  const modelDir = path.join(targetDir, 'src', 'main', 'java', ...pp, 'model');
  const repoDir = path.join(targetDir, 'src', 'main', 'java', ...pp, 'repository');
  const serviceDir = path.join(targetDir, 'src', 'main', 'java', ...pp, 'service');
  const dtoDir = path.join(targetDir, 'src', 'main', 'java', ...pp, 'dto');
  const ctrlDir = path.join(targetDir, 'src', 'main', 'java', ...pp, 'controller');

  fs.mkdirSync(dtoDir, { recursive: true });
  fs.mkdirSync(serviceDir, { recursive: true });
  fs.mkdirSync(ctrlDir, { recursive: true });

  const reqFields = [];
  const respFields = [];
  const saveAssigns = [];
  const respAssigns = [];

  respFields.push('    private Long id;');
  respAssigns.push('        resp.setId(entity.getId());');

  for (const f of fields) {
    const jt = javaType(f.type);
    const fn = toCamelCase(f.name);
    const cap = fn.charAt(0).toUpperCase() + fn.slice(1);
    reqFields.push('    private ' + jt + ' ' + fn + ';');
    respFields.push('    private ' + jt + ' ' + fn + ';');
    saveAssigns.push('        entity.set' + cap + '(dto.get' + cap + '());');
    respAssigns.push('        resp.set' + cap + '(entity.get' + cap + '());');
  }

  const reqImports = fields.some(f => javaType(f.type) === 'BigDecimal')
    ? 'import java.math.BigDecimal;\n' : '';

  // Request DTO
  let dtoReq = '';
  dtoReq += 'package ' + dtoPkg + ';\n\n';
  dtoReq += reqImports;
  dtoReq += 'import jakarta.validation.constraints.NotBlank;\n';
  dtoReq += 'import jakarta.validation.constraints.Size;\n';
  dtoReq += 'import lombok.AllArgsConstructor;\n';
  dtoReq += 'import lombok.Data;\n';
  dtoReq += 'import lombok.NoArgsConstructor;\n\n';
  dtoReq += '@Data\n@AllArgsConstructor\npublic class ' + entityName + 'Request {\n';
  dtoReq += reqFields.join('\n');
  dtoReq += '\n}\n';
  fs.writeFileSync(path.join(dtoDir, entityName + 'Request.java'), dtoReq);

  // Response DTO
  let dtoResp = '';
  dtoResp += 'package ' + dtoPkg + ';\n\n';
  dtoResp += 'import lombok.AllArgsConstructor;\n';
  dtoResp += 'import lombok.Data;\n';
  dtoResp += 'import lombok.NoArgsConstructor;\n\n';
  dtoResp += '@Data\n@NoArgsConstructor\n@AllArgsConstructor\npublic class ' + entityName + 'Response {\n';
  dtoResp += respFields.join('\n');
  dtoResp += '\n}\n';
  fs.writeFileSync(path.join(dtoDir, entityName + 'Response.java'), dtoResp);

  // Service
  let svc = '';
  svc += 'package ' + servicePkg + ';\n\n';
  svc += 'import ' + modelPkg + '.' + entityName + ';\n';
  svc += 'import ' + repoPkg + '.' + entityName + 'Repository;\n';
  svc += 'import ' + dtoPkg + '.' + entityName + 'Request;\n';
  svc += 'import ' + dtoPkg + '.' + entityName + 'Response;\n';
  svc += 'import org.springframework.stereotype.Service;\n';
  svc += 'import org.springframework.transaction.annotation.Transactional;\n\n';
  svc += 'import java.util.List;\n';
  svc += 'import java.util.stream.Collectors;\n\n';
  svc += '@Service\n@Transactional\npublic class ' + entityName + 'Service {\n\n';
  svc += '    private final ' + entityName + 'Repository repository;\n\n';
  svc += '    public ' + entityName + 'Service(' + entityName + 'Repository repository) {\n';
  svc += '        this.repository = repository;\n    }\n\n';
  svc += '    public List<' + entityName + 'Response> findAll() {\n';
  svc += '        return repository.findAll().stream()\n';
  svc += '                .map(this::toResponse)\n';
  svc += '                .collect(Collectors.toList());\n    }\n\n';
  svc += '    public ' + entityName + 'Response findById(Long id) {\n';
  svc += '        ' + entityName + ' entity = repository.findById(id)\n';
  svc += '                .orElseThrow(() -> new RuntimeException("' + entityName + ' not found with id: " + id));\n';
  svc += '        return toResponse(entity);\n    }\n\n';
  svc += '    public ' + entityName + 'Response create(' + entityName + 'Request dto) {\n';
  svc += '        ' + entityName + ' entity = new ' + entityName + '();\n';
  svc += '        updateEntityFromDto(entity, dto);\n';
  svc += '        return toResponse(repository.save(entity));\n    }\n\n';
  svc += '    public ' + entityName + 'Response update(Long id, ' + entityName + 'Request dto) {\n';
  svc += '        ' + entityName + ' existing = repository.findById(id)\n';
  svc += '                .orElseThrow(() -> new RuntimeException("' + entityName + ' not found with id: " + id));\n';
  svc += '        updateEntityFromDto(existing, dto);\n';
  svc += '        return toResponse(repository.save(existing));\n    }\n\n';
  svc += '    public void delete(Long id) {\n';
  svc += '        if (!repository.existsById(id)) {\n';
  svc += '            throw new RuntimeException("' + entityName + ' not found with id: " + id);\n';
  svc += '        }\n';
  svc += '        repository.deleteById(id);\n    }\n\n';
  svc += '    private ' + entityName + 'Response toResponse(' + entityName + ' entity) {\n';
  svc += '        ' + entityName + 'Response resp = new ' + entityName + 'Response();\n';
  svc += respAssigns.join('\n');
  svc += '\n        return resp;\n    }\n\n';
  svc += '    private void updateEntityFromDto(' + entityName + ' entity, ' + entityName + 'Request dto) {\n';
  svc += saveAssigns.join('\n');
  svc += '\n    }\n}\n';
  fs.writeFileSync(path.join(serviceDir, entityName + 'Service.java'), svc);

  // Controller
  let ctrl = '';
  ctrl += 'package ' + ctrlPkg + ';\n\n';
  ctrl += 'import ' + dtoPkg + '.' + entityName + 'Request;\n';
  ctrl += 'import ' + dtoPkg + '.' + entityName + 'Response;\n';
  ctrl += 'import ' + servicePkg + '.' + entityName + 'Service;\n';
  ctrl += 'import jakarta.validation.Valid;\n';
  ctrl += 'import org.springframework.http.ResponseEntity;\n';
  ctrl += 'import org.springframework.web.bind.annotation.*;\n\n';
  ctrl += 'import java.util.List;\n\n';
  ctrl += '@CrossOrigin(origins = "*", allowedHeaders = {"Authorization", "Content-Type"})\n';
  ctrl += '@RestController\n';
  ctrl += '@RequestMapping("/api/' + entityVar + 's")\n';
  ctrl += 'public class ' + entityName + 'Controller {\n\n';
  ctrl += '    private final ' + entityName + 'Service service;\n\n';
  ctrl += '    public ' + entityName + 'Controller(' + entityName + 'Service service) {\n';
  ctrl += '        this.service = service;\n    }\n\n';
  ctrl += '    @GetMapping\n';
  ctrl += '    public ResponseEntity<List<' + entityName + 'Response>> getAll() {\n';
  ctrl += '        return ResponseEntity.ok(service.findAll());\n    }\n\n';
  ctrl += '    @GetMapping("/{id}")\n';
  ctrl += '    public ResponseEntity<' + entityName + 'Response> getById(@PathVariable Long id) {\n';
  ctrl += '        return ResponseEntity.ok(service.findById(id));\n    }\n\n';
  ctrl += '    @PostMapping\n';
  ctrl += '    public ResponseEntity<' + entityName + 'Response> create(@Valid @RequestBody ' + entityName + 'Request dto) {\n';
  ctrl += '        return ResponseEntity.ok(service.create(dto));\n    }\n\n';
  ctrl += '    @PutMapping("/{id}")\n';
  ctrl += '    public ResponseEntity<' + entityName + 'Response> update(@PathVariable Long id, @Valid @RequestBody ' + entityName + 'Request dto) {\n';
  ctrl += '        return ResponseEntity.ok(service.update(id, dto));\n    }\n\n';
  ctrl += '    @DeleteMapping("/{id}")\n';
  ctrl += '    public ResponseEntity<Void> delete(@PathVariable Long id) {\n';
  ctrl += '        service.delete(id);\n';
  ctrl += '        return ResponseEntity.noContent().build();\n    }\n}\n';
  fs.writeFileSync(path.join(ctrlDir, entityName + 'Controller.java'), ctrl);

  console.log('\n[CRUD] Generated ' + entityName + ' CRUD: controller, service, request/response DTOs under /api/' + entityVar + 's');
}

module.exports = { generateCrudForEntity, detectPackage };
