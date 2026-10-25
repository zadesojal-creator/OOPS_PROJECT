#pragma once
#include <string>
#include "Enums.h"

namespace ClinicQueue {

/*
 * Person — abstract base class (OOP: Abstraction + Inheritance).
 *
 * Every human entity in the system (patient, doctor, receptionist,
 * administrator) IS-A Person.  Common attributes live here so they are
 * never duplicated.
 *
 * The virtual destructor is the C++ contract that says:
 *   "Deleting a derived class through a Person* is safe."
 */
class Person {
public:
    // Constructor: initialise every field so we never read garbage.
    Person(std::string id, std::string name, std::string phone, int age, std::string gender)
        : id_(std::move(id))
        , name_(std::move(name))
        , phone_(std::move(phone))
        , age_(age)
        , gender_(std::move(gender))
    {}

    // Virtual destructor — required when a class is used polymorphically.
    virtual ~Person() = default;

    // ── Getters (Encapsulation: data is private, access is controlled) ──
    const std::string& id()     const { return id_; }
    const std::string& name()   const { return name_; }
    const std::string& phone()  const { return phone_; }
    int                age()    const { return age_; }
    const std::string& gender() const { return gender_; }

    // ── Pure virtual: every subclass MUST say what role it is ──
    // (OOP: Polymorphism via virtual functions)
    virtual Role role() const = 0;

    // ── Setters ──
    void setName(std::string n)  { name_  = std::move(n); }
    void setPhone(std::string p) { phone_ = std::move(p); }
    void setAge(int a)           { age_   = a; }

private:
    std::string id_;
    std::string name_;
    std::string phone_;
    int         age_;
    std::string gender_;
};

} // namespace ClinicQueue
