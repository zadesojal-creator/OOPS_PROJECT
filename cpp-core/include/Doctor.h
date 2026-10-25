#pragma once
#include "Person.h"
#include "DoctorSchedule.h"
#include <string>
#include <vector>

namespace ClinicQueue {

// Forward declaration — DoctorSchedule.h is included above.

/*
 * Doctor — IS-A Person (OOP: Inheritance).
 *
 * A doctor adds:
 *   - specialization : e.g. "Cardiologist"
 *   - active / onDuty flags
 *   - Composition: a Doctor HAS-A DoctorSchedule
 */
class Doctor : public Person {
public:
    Doctor(std::string id,
           std::string name,
           std::string phone,
           int age,
           std::string gender,
           std::string specialization,
           bool active = true,
           bool onDuty = false)
        : Person(std::move(id), std::move(name), std::move(phone), age, std::move(gender))
        , specialization_(std::move(specialization))
        , active_(active)
        , onDuty_(onDuty)
    {}

    Role role() const override { return Role::Doctor; }

    const std::string& specialization() const { return specialization_; }
    bool               active()         const { return active_; }
    bool               onDuty()         const { return onDuty_; }

    void setSpecialization(std::string s) { specialization_ = std::move(s); }
    void setActive(bool a)  { active_ = a; }
    void setOnDuty(bool od) { onDuty_ = od; }

private:
    std::string specialization_;
    bool        active_;
    bool        onDuty_;
};

} // namespace ClinicQueue
