cmake_minimum_required(VERSION 3.21)
project(clinicqueue-engine LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Fetch nlohmann_json
include(FetchContent)
FetchContent_Declare(json
  URL https://github.com/nlohmann/json/releases/download/v3.11.3/json.tar.xz
)
FetchContent_MakeAvailable(json)

# Add the main engine executable
add_executable(clinicqueue-engine
    src/main.cpp
    src/QueueManager.cpp
    src/AppointmentService.cpp
    src/ValidationService.cpp
)
target_include_directories(clinicqueue-engine PRIVATE include)
target_link_libraries(clinicqueue-engine PRIVATE nlohmann_json::nlohmann_json)

# Add tests
enable_testing()

add_executable(test-queue
    tests/test_queue.cpp
    src/QueueManager.cpp
)
target_include_directories(test-queue PRIVATE include)

add_executable(test-appointments
    tests/test_appointments.cpp
    src/AppointmentService.cpp
)
target_include_directories(test-appointments PRIVATE include)

add_test(NAME queue-logic COMMAND test-queue)
add_test(NAME appointment-logic COMMAND test-appointments)
