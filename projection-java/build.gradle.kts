// 설계서 §3.3·§4.2 G2: 상위 저장소 portal-projection의 복사본(§14.1-8 — "복사 + 해시 고정", PHASES Phase 1 항목 4)과 리플레이 CLI.
// 복사본은 upstream/ 아래에 원본 경로 그대로 두고 고치지 않는다(UPSTREAM·CHECKSUMS, UpstreamPinTest). 우리 코드는 src/만.
// 루트 `pnpm -r test`에는 포함되지 않는다(설계서 v0.1.1). `./gradlew test`, `./gradlew installDist`.
plugins {
    java
    application
}

java {
    toolchain {
        languageVersion = JavaLanguageVersion.of(25)
    }
}

repositories {
    mavenCentral()
}

// 상위 portal-projection/gradle.lockfile(126d848)과 같은 판. 상위는 Spring Boot BOM 4.1.1로 받지만 여기서는 BOM 없이 판을 고정한다.
val jacksonVersion = "3.1.5"
val assertjVersion = "3.27.7"
val junitVersion = "6.0.3"

val upstream = layout.projectDirectory.dir("upstream")

sourceSets {
    main {
        java {
            srcDir(upstream.dir("platform-core/src/main/java"))
            srcDir(upstream.dir("portal-domain/src/main/java"))
            srcDir(upstream.dir("portal-projection/src/main/java"))
            // 인메모리 뷰 저장소·Envelope 읽기·정규형 뷰(GoldenViews)는 상위에서 시험 픽스처지만 CLI가 쓴다
            srcDir(upstream.dir("portal-projection/src/testFixtures/java"))
        }
    }
    test {
        java {
            srcDir(upstream.dir("portal-projection/src/test/java"))
        }
    }
}

dependencies {
    implementation("tools.jackson.core:jackson-databind:$jacksonVersion")
    // GoldenViews(상위 시험 픽스처)가 assertMatches에서 쓴다 — CLI 경로는 부르지 않는다
    implementation("org.assertj:assertj-core:$assertjVersion")

    testImplementation(platform("org.junit:junit-bom:$junitVersion"))
    testImplementation("org.junit.jupiter:junit-jupiter")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

application {
    mainClass = "com.ga.copilot.replay.ReplayCli"
    applicationName = "projection-java"
}

// 상위 시험 픽스처(Envelopes·GoldenViews)는 시스템 속성 ga.repoRoot 아래에서 상위 저장소 배치를 찾는다
// (contracts/events/v1/samples, portal-projection/src/test/resources). 같은 배치를 build/ 아래에 만든다.
val upstreamRoot = tasks.register<Sync>("upstreamRoot") {
    into(layout.buildDirectory.dir("upstream-root"))
    from(rootProject.layout.projectDirectory.dir("../contracts")) { into("contracts") }
    from(upstream.dir("portal-projection/src/test/resources")) { into("portal-projection/src/test/resources") }
}

tasks.test {
    useJUnitPlatform()
    dependsOn(upstreamRoot)
    inputs.dir(rootProject.layout.projectDirectory.dir("../contracts")).withPathSensitivity(PathSensitivity.RELATIVE)
    inputs.dir(upstream).withPathSensitivity(PathSensitivity.RELATIVE)
    systemProperty("ga.repoRoot", upstreamRoot.get().destinationDir.absolutePath)
    systemProperty("copilot.projectionDir", layout.projectDirectory.asFile.absolutePath)
    systemProperty("golden.update", "false")
}
