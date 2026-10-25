#pragma once
#include "Doctor.h"
#include <vector>
#include <memory>

namespace ClinicQueue {

/*
 * Clinic — Composition (HAS-A).
 * 
 * Demonstrates a high-level OOP structure where the Clinic contains a list
 * of Doctors. This class can act as an aggregate root for domain operations.
 */
class Clinic {
public:
    Clinic(std::string name, std::string address)
        : name_(std::move(name)), address_(std::move(address)) {}

    void addDoctor(std::shared_ptr<Doctor> doctor) {
        doctors_.push_back(std::move(doctor));
    }

    const std::vector<std::shared_ptr<Doctor>>& getDoctors() const {
        return doctors_;
    }

    const std::string& name() const { return name_; }
    const std::string& address() const { return address_; }

private:
    std::string name_;
    std::string address_;
    std::vector<std::shared_ptr<Doctor>> doctors_;
};

} // namespace ClinicQueue
