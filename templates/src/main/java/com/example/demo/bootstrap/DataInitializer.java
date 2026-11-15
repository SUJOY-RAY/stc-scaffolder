package __PKG__.bootstrap;

import __PKG__.model.ERole;
import __PKG__.model.Role;
import __PKG__.model.User;
import __PKG__.repository.RoleRepository;
import __PKG__.repository.UserRepository;
import org.springframework.boot.CommandLineRunner;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.crypto.password.PasswordEncoder;

import java.util.HashSet;
import java.util.Set;

@Configuration
public class DataInitializer {

    @Bean
    CommandLineRunner init(RoleRepository roleRepository,
                           UserRepository userRepository,
                           PasswordEncoder passwordEncoder) {
        return args -> {
            // Seed roles (multiple roles supported)
            if (roleRepository.count() == 0) {
                roleRepository.save(new Role(ERole.ROLE_ADMIN));
                roleRepository.save(new Role(ERole.ROLE_USER));
            }

            // Create one default admin user
            if (!userRepository.existsByUsername("admin")) {
                User admin = new User();
                admin.setUsername("admin");
                admin.setEmail("__ADMINEMAIL__");
                admin.setPassword(passwordEncoder.encode("admin123"));

                Set<Role> roles = new HashSet<>();
                roles.add(roleRepository.findByName(ERole.ROLE_ADMIN)
                        .orElseThrow(() -> new RuntimeException("Role ADMIN not found")));
                roles.add(roleRepository.findByName(ERole.ROLE_USER)
                        .orElseThrow(() -> new RuntimeException("Role USER not found")));
                admin.setRoles(roles);

                userRepository.save(admin);
                System.out.println(">>> Default admin user created: username=admin, password=admin123");
            }
        };
    }
}
