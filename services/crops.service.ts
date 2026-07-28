import { CropsRepository } from "@/repositories/crop.repositories";

export class CropsService {
  constructor(private readonly cropsRepo: CropsRepository) {}

  async getAllCrops(limit: number = 10) {
    return this.cropsRepo.findAll(limit);
  }

  async getCropById(id: number) {
    return this.cropsRepo.findById(id);
  }

  async getCropByCode(code: string) {
    return this.cropsRepo.findByCode(code);
  }
}
