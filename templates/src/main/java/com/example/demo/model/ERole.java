package __PKG__.model;

/**
 * Application roles. Stored with the "ROLE_" prefix so they map directly to
 * Spring Security GrantedAuthority values (e.g. ROLE_ADMIN, ROLE_USER).
 */
public enum ERole {
    ROLE_ADMIN,
    ROLE_USER
}
