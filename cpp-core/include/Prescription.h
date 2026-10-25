#pragma once
#include <string>
#include <vector>

namespace ClinicQueue {

struct Medication {
    std::string name;
    std::string dosage;
    std::string duration;
};

/*
 * Prescription
 * Represents a medical prescription issued to a patient by a doctor.
 */
class Prescription {
public:
    Prescription(std::string id,
                 std::string consultationId,
                 std::string patientId,
                 std::string patientName,
                 std::vector<Medication> medications,
                 std::string instructions)
        : id_(std::move(id))
        , consultationId_(std::move(consultationId))
        , patientId_(std::move(patientId))
        , patientName_(std::move(patientName))
        , medications_(std::move(medications))
        , instructions_(std::move(instructions))
    {}

    const std::string& id() const { return id_; }
    const std::string& consultationId() const { return consultationId_; }
    const std::string& patientId() const { return patientId_; }
    const std::string& patientName() const { return patientName_; }
    const std::vector<Medication>& medications() const { return medications_; }
    const std::string& instructions() const { return instructions_; }

private:
    std::string id_;
    std::string consultationId_;
    std::string patientId_;
    std::string patientName_;
    std::vector<Medication> medications_;
    std::string instructions_;
};

} // namespace ClinicQueue
