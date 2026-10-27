// 설계서 §3.3·§11: 상위 저장소 portal-projection을 담을 자리(Phase 1). Phase 0은 Java 25 툴체인 선언만 둔다.
// 루트 `pnpm -r test`에는 포함되지 않는다(설계서 v0.1.1). JDK 25는 Phase 1 전 사람 작업으로 설치한다.
plugins {
    java
}

java {
    toolchain {
        languageVersion = JavaLanguageVersion.of(25)
    }
}

repositories {
    mavenCentral()
}
