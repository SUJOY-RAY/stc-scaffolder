const fs = require('fs');
const path = require('path');
const { javaType, toCamelCase } = require('./utils');
const { walk } = require('./files');

// On-disk reference package path (for directory renaming). The template files
// themselves use placeholders (__PKG__, __GROUP__, etc.).
const REF_PACKAGE_PATH = 'com/example/demo';
const REF_MAIN_CLASS = '__MAIN__';
const REF_JAVA_VERSION = '21';
const REF_SB_VERSION = '4.1.2';

// Placeholder tokens used inside template files.
const PL = {
  PKG: '__PKG__',
  PKGPATH: '__PKGPATH__',
  GROUP: '__GROUP__',
  ARTIFACT: '__ARTIFACT__',
  ARTUS: '__ARTUS__',
  MAIN: '__MAIN__',
  TESTS: '__MAINTESTS__',
  TITLE: '__TITLE__',
  VER: '__VER__',
  JAVAVER: '__JAVAVER__',
  SBVER: '__SBVER__',
  JWT: '__JWT__',
  ADMINEMAIL: '__ADMINEMAIL__',
  DBDEV: '__DBDEV__',
  DBQA: '__DBQA__',
  DBPROD: '__DBPROD__',
};

/** Apply ordered string replacements to file content (longest token first). */
function replaceTokens(content, repls) {
  let out = content;
  const ordered = [...repls].sort((a, b) => b[0].length - a[0].length);
  for (const [from, to] of ordered) {
    out = out.split(from).join(String(to));
  }
  return out;
}

/** Generate User.java with custom fields injected (dynamic package). */
function generateUserJava(pkg, fields) {
  const modelPkg = pkg + '.model';
  let imports = `
import jakarta.persistence.*;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.springframework.data.annotation.CreatedDate;
import org.springframework.data.jpa.domain.support.AuditingEntityListener;

import java.time.Instant;
import java.util.HashSet;
import java.util.Set;`;
  let needsBigDecimal = false;
  let customFields = '';
  for (const f of fields) {
    const jt = javaType(f.type);
    if (jt === 'BigDecimal') needsBigDecimal = true;
    const fieldName = toCamelCase(f.name);
    customFields += `
    @Column(name = "${f.name}")
    private ${jt} ${fieldName};`;
  }
  if (needsBigDecimal) imports += `
import java.math.BigDecimal;`;

  return `package ${modelPkg};${imports}

@Entity
@Table(name = "users", uniqueConstraints = {
        @UniqueConstraint(columnNames = "username"),
        @UniqueConstraint(columnNames = "email")
})
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
@EntityListeners(AuditingEntityListener.class)
public class User {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @NotBlank
    @Size(max = 20)
    private String username;

    @NotBlank
    @Size(max = 50)
    @Email
    private String email;

    @NotBlank
    @Size(max = 120)
    private String password;${customFields}

    @ManyToMany(fetch = FetchType.LAZY)
    @JoinTable(name = "user_roles",
            joinColumns = @JoinColumn(name = "user_id"),
            inverseJoinColumns = @JoinColumn(name = "role_id"))
    private Set<Role> roles = new HashSet<>();

    @CreatedDate
    private Instant createdAt;
}
`;
}

module.exports = {
  REF_PACKAGE_PATH,
  REF_MAIN_CLASS,
  REF_JAVA_VERSION,
  REF_SB_VERSION,
  PL,
  replaceTokens,
  generateUserJava,
};
